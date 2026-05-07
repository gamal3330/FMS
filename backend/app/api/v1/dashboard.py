from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.enums import ApprovalAction, RequestStatus, UserRole
from app.models.message import InternalMessage, InternalMessageRecipient
from app.models.request import ApprovalStep, ServiceRequest
from app.models.user import Department, User
from app.schemas.dashboard import DashboardStats
from app.services.workflow import IMPLEMENTATION_STEP_ROLES
from app.api.v1.users import read_user_screens

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])
MANAGEMENT_STATS_ROLES = {UserRole.IT_MANAGER, UserRole.EXECUTIVE, UserRole.SUPER_ADMIN}
SECTION_KEYWORDS = {
    "servers": ["server", "servers", "srv", "سيرفر", "خوادم"],
    "networks": ["network", "networks", "net", "شبكة", "شبكات"],
    "support": ["support", "helpdesk", "دعم", "فني"],
    "development": ["development", "software", "dev", "تطوير", "برامج"],
}
REQUEST_STATUS_LABELS = {
    RequestStatus.DRAFT: "مسودة",
    RequestStatus.SUBMITTED: "مرسل",
    RequestStatus.PENDING_APPROVAL: "بانتظار الموافقة",
    RequestStatus.RETURNED_FOR_EDIT: "معاد للتعديل",
    RequestStatus.APPROVED: "تمت الموافقة",
    RequestStatus.REJECTED: "مرفوض",
    RequestStatus.IN_IMPLEMENTATION: "قيد التنفيذ",
    RequestStatus.COMPLETED: "مكتمل",
    RequestStatus.CLOSED: "مغلق",
    RequestStatus.CANCELLED: "ملغي",
}
MESSAGE_TYPE_LABELS = {
    "internal_correspondence": "مراسلة داخلية",
    "official_correspondence": "مراسلة رسمية",
    "clarification_request": "طلب استيضاح",
    "clarification_response": "رد على استيضاح",
    "approval_note": "ملاحظة موافقة",
    "rejection_reason": "سبب رفض",
    "implementation_note": "ملاحظة تنفيذ",
    "notification": "إشعار",
    "circular": "تعميم",
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


def request_type_label(value) -> str:
    text = getattr(value, "value", value)
    labels = {
        "email": "طلب إيميل",
        "domain": "طلب دومين",
        "vpn_remote_access": "طلب VPN",
        "internet_access": "طلب وصول إنترنت",
        "data_copy": "طلب نسخ بيانات",
        "network_access": "طلب وصول شبكة",
        "computer_move_installation": "طلب تركيب / نقل جهاز",
        "it_support_ticket": "طلب دعم فني",
    }
    return labels.get(str(text), str(text or "-"))


def dashboard_messages(db: Session, current_user: User) -> dict:
    unread = db.scalar(
        select(func.count())
        .select_from(InternalMessageRecipient)
        .join(InternalMessage, InternalMessage.id == InternalMessageRecipient.message_id)
        .where(
            InternalMessageRecipient.recipient_id == current_user.id,
            InternalMessageRecipient.is_read == False,
            InternalMessageRecipient.is_archived == False,
            InternalMessage.is_draft == False,
        )
    ) or 0
    inbox_total = db.scalar(
        select(func.count())
        .select_from(InternalMessageRecipient)
        .join(InternalMessage, InternalMessage.id == InternalMessageRecipient.message_id)
        .where(
            InternalMessageRecipient.recipient_id == current_user.id,
            InternalMessageRecipient.is_archived == False,
            InternalMessage.is_draft == False,
        )
    ) or 0
    sent_total = db.scalar(
        select(func.count())
        .select_from(InternalMessage)
        .where(InternalMessage.sender_id == current_user.id, InternalMessage.is_draft == False, InternalMessage.is_sender_archived == False)
    ) or 0
    drafts = db.scalar(select(func.count()).select_from(InternalMessage).where(InternalMessage.sender_id == current_user.id, InternalMessage.is_draft == True)) or 0
    linked_messages = db.scalar(
        select(func.count(func.distinct(InternalMessage.id)))
        .select_from(InternalMessage)
        .join(InternalMessageRecipient, InternalMessageRecipient.message_id == InternalMessage.id, isouter=True)
        .where(
            InternalMessage.related_request_id.isnot(None),
            InternalMessage.is_draft == False,
            or_(InternalMessage.sender_id == current_user.id, InternalMessageRecipient.recipient_id == current_user.id),
        )
    ) or 0
    by_type_rows = db.execute(
        select(InternalMessage.message_type, func.count(func.distinct(InternalMessage.id)).label("count"))
        .join(InternalMessageRecipient, InternalMessageRecipient.message_id == InternalMessage.id, isouter=True)
        .where(
            InternalMessage.is_draft == False,
            or_(InternalMessage.sender_id == current_user.id, InternalMessageRecipient.recipient_id == current_user.id),
        )
        .group_by(InternalMessage.message_type)
        .order_by(func.count(func.distinct(InternalMessage.id)).desc())
    ).all()
    recent_rows = db.execute(
        select(
            InternalMessage.id,
            InternalMessage.message_uid,
            InternalMessage.subject,
            InternalMessage.message_type,
            InternalMessage.created_at,
            User.full_name_ar.label("sender_name"),
            InternalMessageRecipient.is_read,
        )
        .join(InternalMessageRecipient, InternalMessageRecipient.message_id == InternalMessage.id)
        .join(User, User.id == InternalMessage.sender_id)
        .where(
            InternalMessageRecipient.recipient_id == current_user.id,
            InternalMessageRecipient.is_archived == False,
            InternalMessage.is_draft == False,
        )
        .order_by(InternalMessageRecipient.is_read.asc(), InternalMessage.created_at.desc())
        .limit(5)
    ).all()
    return {
        "unread": unread,
        "inbox_total": inbox_total,
        "sent_total": sent_total,
        "drafts": drafts,
        "linked_messages": linked_messages,
        "by_type": [
            {"type": row.message_type, "label": MESSAGE_TYPE_LABELS.get(row.message_type, row.message_type), "count": row.count}
            for row in by_type_rows
        ],
        "recent": [
            {
                "id": row.id,
                "message_uid": row.message_uid,
                "subject": row.subject,
                "message_type": row.message_type,
                "message_type_label": MESSAGE_TYPE_LABELS.get(row.message_type, row.message_type),
                "sender_name": row.sender_name,
                "is_read": bool(row.is_read),
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in recent_rows
        ],
    }


def recent_request_activity(db: Session, scoped_ids) -> list[dict]:
    rows = db.execute(
        select(
            ServiceRequest.id,
            ServiceRequest.request_number,
            ServiceRequest.title,
            ServiceRequest.status,
            ServiceRequest.updated_at,
            User.full_name_ar.label("requester_name"),
        )
        .join(User, User.id == ServiceRequest.requester_id)
        .where(ServiceRequest.id.in_(scoped_ids))
        .order_by(ServiceRequest.updated_at.desc())
        .limit(6)
    ).all()
    return [
        {
            "id": row.id,
            "request_number": row.request_number,
            "title": row.title,
            "status": row.status,
            "status_label": REQUEST_STATUS_LABELS.get(row.status, row.status),
            "requester_name": row.requester_name,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
        for row in rows
    ]


@router.get("/stats", response_model=DashboardStats)
def stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if "dashboard" not in read_user_screens(db, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Dashboard statistics are not enabled for this user")

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
    by_status = db.execute(
        select(ServiceRequest.status, func.count().label("count"))
        .where(ServiceRequest.id.in_(scoped_ids))
        .group_by(ServiceRequest.status)
        .order_by(func.count().desc())
    ).all()
    by_type = db.execute(
        select(ServiceRequest.request_type, func.count().label("count"))
        .where(ServiceRequest.id.in_(scoped_ids))
        .group_by(ServiceRequest.request_type)
        .order_by(func.count().desc())
        .limit(8)
    ).all()
    attention_items = []
    if pending_approvals:
        attention_items.append({"tone": "warning", "title": "موافقات معلقة", "description": f"{pending_approvals} خطوة اعتماد ما زالت بانتظار الإجراء."})
    returned_for_edit = db.scalar(
        select(func.count())
        .select_from(ServiceRequest)
        .where(ServiceRequest.id.in_(scoped_ids), ServiceRequest.status == RequestStatus.RETURNED_FOR_EDIT)
    ) or 0
    if returned_for_edit:
        attention_items.append({"tone": "info", "title": "طلبات معادة للتعديل", "description": f"{returned_for_edit} طلب يحتاج تحديثاً قبل إعادة الإرسال."})
    messages = dashboard_messages(db, current_user)
    if messages["unread"]:
        attention_items.append({"tone": "message", "title": "رسائل غير مقروءة", "description": f"{messages['unread']} رسالة في الوارد لم تتم قراءتها."})
    return DashboardStats(
        open_requests=open_requests,
        pending_approvals=pending_approvals,
        completed_requests=completed_requests,
        delayed_requests=delayed_requests,
        monthly_statistics=[{"month": row.month, "count": row.count} for row in monthly],
        requests_by_department=[{"department": row.department, "count": row.count} for row in by_department],
        requests_by_status=[{"status": row.status, "label": REQUEST_STATUS_LABELS.get(row.status, row.status), "count": row.count} for row in by_status],
        requests_by_type=[{"type": row.request_type, "label": request_type_label(row.request_type), "count": row.count} for row in by_type],
        messages=messages,
        recent_requests=recent_request_activity(db, scoped_ids),
        attention_items=attention_items[:5],
        can_view_it_staff_statistics=current_user.role in MANAGEMENT_STATS_ROLES,
        it_staff_statistics=it_staff_statistics(db, current_user),
    )
