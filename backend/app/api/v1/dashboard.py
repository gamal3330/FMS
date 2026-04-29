from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.enums import ApprovalAction, RequestStatus, UserRole
from app.models.request import ApprovalStep, ServiceRequest
from app.models.user import Department, User
from app.schemas.dashboard import DashboardStats
from app.services.workflow import IMPLEMENTATION_STEP_ROLES

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])
MANAGEMENT_STATS_ROLES = {UserRole.IT_MANAGER, UserRole.EXECUTIVE, UserRole.SUPER_ADMIN}
SECTION_KEYWORDS = {
    "servers": ["server", "servers", "srv", "سيرفر", "خوادم"],
    "networks": ["network", "networks", "net", "شبكة", "شبكات"],
    "support": ["support", "helpdesk", "دعم", "فني"],
    "development": ["development", "software", "dev", "تطوير", "برامج"],
}


def user_administrative_section(user: User) -> str | None:
    if user.administrative_section:
        return user.administrative_section
    department = user.department
    if not department:
        return None
    text = f"{department.name_ar or ''} {department.name_en or ''} {department.code or ''}".lower()
    for section, keywords in SECTION_KEYWORDS.items():
        if any(keyword.lower() in text for keyword in keywords):
            return section
    return None


def scoped_request_ids(current_user: User):
    stmt = select(ServiceRequest.id)

    if current_user.role in {UserRole.SUPER_ADMIN, UserRole.IT_MANAGER, UserRole.EXECUTIVE}:
        return stmt

    own_request = ServiceRequest.requester_id == current_user.id

    if current_user.role == UserRole.EMPLOYEE:
        return stmt.where(own_request)

    if current_user.role == UserRole.DIRECT_MANAGER:
        team_members = select(User.id).where(User.manager_id == current_user.id)
        return stmt.where(or_(own_request, ServiceRequest.requester_id.in_(team_members)))

    approval_requests = select(ApprovalStep.request_id).where(ApprovalStep.role == current_user.role)
    if current_user.role == UserRole.IT_STAFF:
        approval_requests = select(ApprovalStep.request_id).where(ApprovalStep.role.in_([UserRole.IT_STAFF, *IMPLEMENTATION_STEP_ROLES]))
        staff_section = user_administrative_section(current_user)
        request_section = func.coalesce(
            ServiceRequest.form_data["assigned_section"].as_string(),
            ServiceRequest.form_data["administrative_section"].as_string(),
        )
        if staff_section:
            return stmt.where(
                or_(
                    own_request,
                    and_(
                        ServiceRequest.id.in_(approval_requests),
                        request_section == staff_section,
                    ),
                )
            )
        section_has_staff = (
            select(func.count())
            .select_from(User)
            .where(User.role == UserRole.IT_STAFF, User.is_active == True, User.administrative_section == request_section)
            .correlate(ServiceRequest)
            .scalar_subquery()
        )
        return stmt.where(or_(own_request, and_(ServiceRequest.id.in_(approval_requests), request_section.is_not(None), section_has_staff == 0)))

    if current_user.role in {UserRole.INFOSEC, UserRole.EXECUTIVE, UserRole.IT_STAFF}:
        return stmt.where(or_(own_request, ServiceRequest.id.in_(approval_requests)))

    return stmt.where(own_request)


def it_staff_statistics(db: Session, current_user: User) -> list[dict]:
    if current_user.role not in MANAGEMENT_STATS_ROLES:
        return []

    processed_steps = (
        select(
            ApprovalStep.approver_id.label("user_id"),
            func.count(func.distinct(ApprovalStep.request_id)).label("processed_requests"),
            func.count(ApprovalStep.id).label("processed_steps"),
            func.max(ApprovalStep.acted_at).label("last_action_at"),
        )
        .where(
            ApprovalStep.approver_id.isnot(None),
            ApprovalStep.action == ApprovalAction.APPROVED,
            ApprovalStep.role.in_([UserRole.IT_STAFF, *IMPLEMENTATION_STEP_ROLES]),
        )
        .group_by(ApprovalStep.approver_id)
        .subquery()
    )

    closed_requests = (
        select(
            ApprovalStep.approver_id.label("user_id"),
            func.count(func.distinct(ServiceRequest.id)).label("closed_requests"),
        )
        .join(ServiceRequest, ServiceRequest.id == ApprovalStep.request_id)
        .where(
            ApprovalStep.approver_id.isnot(None),
            ApprovalStep.action == ApprovalAction.APPROVED,
            ApprovalStep.role.in_([UserRole.IT_STAFF, *IMPLEMENTATION_STEP_ROLES]),
            ServiceRequest.status == RequestStatus.CLOSED,
        )
        .group_by(ApprovalStep.approver_id)
        .subquery()
    )

    rows = db.execute(
        select(
            User.id,
            User.full_name_ar,
            User.email,
            Department.name_ar.label("department"),
            func.coalesce(processed_steps.c.processed_requests, 0).label("processed_requests"),
            func.coalesce(processed_steps.c.processed_steps, 0).label("processed_steps"),
            func.coalesce(closed_requests.c.closed_requests, 0).label("closed_requests"),
            processed_steps.c.last_action_at,
        )
        .join(Department, Department.id == User.department_id, isouter=True)
        .join(processed_steps, processed_steps.c.user_id == User.id, isouter=True)
        .join(closed_requests, closed_requests.c.user_id == User.id, isouter=True)
        .where(User.role == UserRole.IT_STAFF)
        .order_by(func.coalesce(processed_steps.c.processed_requests, 0).desc(), User.full_name_ar)
    ).all()

    return [
        {
            "user_id": row.id,
            "full_name_ar": row.full_name_ar,
            "email": row.email,
            "department": row.department,
            "processed_requests": row.processed_requests,
            "processed_steps": row.processed_steps,
            "closed_requests": row.closed_requests,
            "last_action_at": row.last_action_at.isoformat() if row.last_action_at else None,
        }
        for row in rows
    ]


@router.get("/stats", response_model=DashboardStats)
def stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    scoped_ids = scoped_request_ids(current_user)

    open_requests = db.scalar(
        select(func.count())
        .select_from(ServiceRequest)
        .where(ServiceRequest.id.in_(scoped_ids), ServiceRequest.status.notin_([RequestStatus.CLOSED, RequestStatus.CANCELLED]))
    ) or 0
    pending_approvals = db.scalar(
        select(func.count())
        .select_from(ApprovalStep)
        .where(ApprovalStep.request_id.in_(scoped_ids), ApprovalStep.action == ApprovalAction.PENDING)
    ) or 0
    completed_requests = db.scalar(
        select(func.count())
        .select_from(ServiceRequest)
        .where(ServiceRequest.id.in_(scoped_ids), ServiceRequest.status == RequestStatus.CLOSED)
    ) or 0
    delayed_requests = db.scalar(
        select(func.count())
        .select_from(ServiceRequest)
        .where(
            ServiceRequest.id.in_(scoped_ids),
            ServiceRequest.sla_due_at < now,
            ServiceRequest.status.notin_([RequestStatus.CLOSED, RequestStatus.CANCELLED]),
        )
    ) or 0
    month_expr = (
        func.strftime("%Y-%m", ServiceRequest.created_at)
        if db.bind and db.bind.dialect.name == "sqlite"
        else func.to_char(ServiceRequest.created_at, "YYYY-MM")
    )
    monthly = db.execute(
        select(month_expr.label("month"), func.count().label("count"))
        .where(ServiceRequest.id.in_(scoped_ids))
        .group_by("month")
        .order_by("month")
    ).all()
    by_department = db.execute(
        select(Department.name_ar.label("department"), func.count(ServiceRequest.id).label("count"))
        .join(ServiceRequest, ServiceRequest.department_id == Department.id)
        .where(ServiceRequest.id.in_(scoped_ids))
        .group_by(Department.name_ar)
        .order_by(Department.name_ar)
    ).all()
    return DashboardStats(
        open_requests=open_requests,
        pending_approvals=pending_approvals,
        completed_requests=completed_requests,
        delayed_requests=delayed_requests,
        monthly_statistics=[{"month": row.month, "count": row.count} for row in monthly],
        requests_by_department=[{"department": row.department, "count": row.count} for row in by_department],
        can_view_it_staff_statistics=current_user.role in MANAGEMENT_STATS_ROLES,
        it_staff_statistics=it_staff_statistics(db, current_user),
    )
