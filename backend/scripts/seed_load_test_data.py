"""Create local load-test data for FMS.

This script is intended for development and staging environments only.
It tags generated users with employee_id prefix LT- so they can be found easily.
"""

from __future__ import annotations

import argparse
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api.v1.messages import generate_message_uid
from app.api.v1.request_type_management import REQUEST_TYPE_CODE_MAP, create_snapshot_steps, section_label
from app.core.security import get_password_hash
from app.db.init_db import ensure_runtime_columns, seed_database
from app.db.session import Base, SessionLocal, engine
from app.models.enums import ApprovalAction, Priority, RequestStatus, RequestType, UserRole
from app.models.message import InternalMessage, InternalMessageRecipient
from app.models.request import ApprovalStep, RequestApprovalStep, ServiceRequest
from app.models.settings import PortalSetting, RequestTypeSetting
from app.models.user import Department, User

TEST_PREFIX = "LT-"
TEST_PASSWORD = "1"
TEST_EMAIL_DOMAIN = "loadtest.qa"
MESSAGE_TYPES = [
    "internal_correspondence",
    "official_correspondence",
    "clarification_request",
    "approval_note",
    "notification",
    "circular",
]
SECTIONS = ["support", "networks", "servers", "development"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed load-test users, requests, and messages.")
    parser.add_argument("--users", type=int, default=100, help="Number of test users to keep/create.")
    parser.add_argument("--requests", type=int, default=180, help="Number of test service requests to create.")
    parser.add_argument("--messages", type=int, default=260, help="Number of internal messages to create.")
    parser.add_argument("--clean", action="store_true", help="Delete previous LT-* test data before creating fresh data.")
    parser.add_argument("--seed", type=int, default=20260506, help="Random seed for repeatable data.")
    return parser.parse_args()


def reset_test_data(db: Session) -> None:
    test_user_ids = [row[0] for row in db.execute(select(User.id).where(User.employee_id.like(f"{TEST_PREFIX}%"))).all()]
    if not test_user_ids:
        return
    test_request_ids = [row[0] for row in db.execute(select(ServiceRequest.id).where(ServiceRequest.requester_id.in_(test_user_ids))).all()]
    test_message_ids = [
        row[0]
        for row in db.execute(
            select(InternalMessage.id).where(
                (InternalMessage.sender_id.in_(test_user_ids)) | (InternalMessage.subject.like("[LT]%"))
            )
        ).all()
    ]
    if test_message_ids:
        db.execute(delete(InternalMessageRecipient).where(InternalMessageRecipient.message_id.in_(test_message_ids)))
        db.execute(delete(InternalMessage).where(InternalMessage.id.in_(test_message_ids)))
    if test_request_ids:
        db.execute(delete(RequestApprovalStep).where(RequestApprovalStep.request_id.in_(test_request_ids)))
        db.execute(delete(ApprovalStep).where(ApprovalStep.request_id.in_(test_request_ids)))
        db.execute(delete(ServiceRequest).where(ServiceRequest.id.in_(test_request_ids)))
    db.execute(delete(PortalSetting).where(PortalSetting.category == "screen_permissions", PortalSetting.setting_key.in_([str(item) for item in test_user_ids])))
    db.execute(delete(User).where(User.id.in_(test_user_ids)))
    db.commit()


def ensure_departments(db: Session) -> list[Department]:
    departments = db.scalars(select(Department).where(Department.is_active == True).order_by(Department.id)).all()
    if departments:
        return departments
    seed_database(db)
    db.commit()
    return db.scalars(select(Department).where(Department.is_active == True).order_by(Department.id)).all()


def test_user(index: int, role: UserRole, department: Department, manager_id: int | None = None, administrative_section: str | None = None) -> User:
    employee_id = f"{TEST_PREFIX}{index:04d}"
    return User(
        employee_id=employee_id,
        username=f"lt.user{index:04d}",
        full_name_ar=f"مستخدم اختبار {index:03d}",
        full_name_en=f"Load Test User {index:03d}",
        email=f"lt.user{index:04d}@{TEST_EMAIL_DOMAIN}",
        mobile=f"55510{index:04d}"[-10:],
        hashed_password=get_password_hash(TEST_PASSWORD),
        password_changed_at=datetime.now(timezone.utc),
        role=role,
        administrative_section=administrative_section,
        department_id=department.id,
        manager_id=manager_id,
        is_active=True,
    )


def set_messages_screen(db: Session, user: User) -> None:
    screens = ["dashboard", "requests", "approvals", "messages"]
    if user.role in {UserRole.IT_STAFF, UserRole.INFOSEC, UserRole.IT_MANAGER, UserRole.EXECUTIVE, UserRole.SUPER_ADMIN}:
        screens.append("reports")
    if user.role in {UserRole.IT_MANAGER, UserRole.SUPER_ADMIN}:
        screens.extend(["users", "departments", "specialized_sections", "request_types", "settings", "health_monitoring"])
    db.add(
        PortalSetting(
            category="screen_permissions",
            setting_key=str(user.id),
            setting_value={"screens": sorted(set(screens)), "messages_permission_initialized": True},
        )
    )


def ensure_test_users(db: Session, target: int) -> list[User]:
    existing = db.scalars(select(User).where(User.employee_id.like(f"{TEST_PREFIX}%")).order_by(User.employee_id)).all()
    if len(existing) >= target:
        return existing[:target]

    departments = ensure_departments(db)
    start = len(existing) + 1
    users = list(existing)
    managers: list[User] = [user for user in users if user.role == UserRole.DIRECT_MANAGER]

    for department in departments:
        if len(users) >= target or any(user.role == UserRole.DIRECT_MANAGER and user.department_id == department.id for user in users):
            continue
        user = test_user(start, UserRole.DIRECT_MANAGER, department)
        db.add(user)
        db.flush()
        set_messages_screen(db, user)
        department.manager_id = user.id
        users.append(user)
        managers.append(user)
        start += 1

    role_plan = (
        [UserRole.IT_MANAGER] * 2
        + [UserRole.INFOSEC] * 4
        + [UserRole.EXECUTIVE] * 2
        + [UserRole.IT_STAFF] * 14
    )
    for role in role_plan:
        if len(users) >= target:
            break
        department = random.choice(departments)
        section = random.choice(SECTIONS) if role == UserRole.IT_STAFF else None
        user = test_user(start, role, department, manager_id=random.choice(managers).id if managers else None, administrative_section=section)
        db.add(user)
        db.flush()
        set_messages_screen(db, user)
        users.append(user)
        start += 1

    while len(users) < target:
        department = random.choice(departments)
        department_managers = [user for user in managers if user.department_id == department.id] or managers
        user = test_user(start, UserRole.EMPLOYEE, department, manager_id=random.choice(department_managers).id if department_managers else None)
        db.add(user)
        db.flush()
        set_messages_screen(db, user)
        users.append(user)
        start += 1

    db.commit()
    return db.scalars(select(User).where(User.employee_id.like(f"{TEST_PREFIX}%")).order_by(User.employee_id)).all()


def active_request_types(db: Session) -> list[RequestTypeSetting]:
    rows = db.scalars(select(RequestTypeSetting).where(RequestTypeSetting.is_active == True).order_by(RequestTypeSetting.id)).all()
    if rows:
        return rows
    seed_database(db)
    db.commit()
    return db.scalars(select(RequestTypeSetting).where(RequestTypeSetting.is_active == True).order_by(RequestTypeSetting.id)).all()


def request_enum_for_type(item: RequestTypeSetting) -> RequestType:
    if item.code in REQUEST_TYPE_CODE_MAP:
        return REQUEST_TYPE_CODE_MAP[item.code]
    return RequestType.SUPPORT


def next_test_request_number(db: Session) -> str:
    year = datetime.now(timezone.utc).year
    prefix = f"QIB-{year}-"
    count = db.scalar(select(ServiceRequest.id).where(ServiceRequest.request_number.like(f"{prefix}%")).order_by(ServiceRequest.id.desc()).limit(1))
    current = db.scalar(select(ServiceRequest.request_number).where(ServiceRequest.request_number.like(f"{prefix}%")).order_by(ServiceRequest.id.desc()).limit(1))
    if current:
        try:
            return f"{prefix}{int(current.rsplit('-', 1)[1]) + 1:06d}"
        except (IndexError, ValueError):
            pass
    return f"{prefix}{(count or 0) + 1:06d}"


def create_fallback_steps(db: Session, request: ServiceRequest) -> None:
    roles = [UserRole.DIRECT_MANAGER.value, UserRole.IT_MANAGER.value, "implementation"]
    for order, role in enumerate(roles, start=1):
        db.add(ApprovalStep(request_id=request.id, step_order=order, role=role, action=ApprovalAction.PENDING))
        db.add(
            RequestApprovalStep(
                request_id=request.id,
                step_name_ar={"direct_manager": "المدير المباشر", "it_manager": "مدير تقنية المعلومات"}.get(role, "التنفيذ"),
                step_name_en=role,
                step_type=role,
                status="pending" if order == 1 else "waiting",
                sort_order=order,
            )
        )


def actor_for_role(users: list[User], role: str, requester: User) -> User | None:
    if role == UserRole.DIRECT_MANAGER.value and requester.manager_id:
        return next((user for user in users if user.id == requester.manager_id), None)
    if role in {"implementation", "execution", "implementation_engineer", "close_request"}:
        return next((user for user in users if user.role == UserRole.IT_STAFF), None)
    try:
        user_role = UserRole(role)
    except ValueError:
        user_role = UserRole.IT_MANAGER
    return next((user for user in users if user.role == user_role), None)


def simulate_workflow(request: ServiceRequest, users: list[User], scenario: str) -> None:
    steps = sorted(request.approvals, key=lambda item: item.step_order)
    snapshots = {item.sort_order: item for item in request.approval_snapshots}
    if not steps:
        return

    if scenario == "pending":
        request.status = RequestStatus.PENDING_APPROVAL
        return

    approve_count = {
        "first_approved": 1,
        "implementation": max(1, len(steps) - 1),
        "closed": len(steps),
        "returned": min(2, len(steps)),
        "rejected": min(2, len(steps)),
    }.get(scenario, 0)
    acted_at = datetime.now(timezone.utc) - timedelta(days=random.randint(0, 20), hours=random.randint(1, 12))

    for step in steps[:approve_count]:
        actor = actor_for_role(users, str(step.role), request.requester)
        if scenario == "returned" and step == steps[approve_count - 1]:
            step.action = ApprovalAction.RETURNED_FOR_EDIT
            request.status = RequestStatus.RETURNED_FOR_EDIT
        elif scenario == "rejected" and step == steps[approve_count - 1]:
            step.action = ApprovalAction.REJECTED
            request.status = RequestStatus.REJECTED
        else:
            step.action = ApprovalAction.APPROVED
        step.approver_id = actor.id if actor else None
        step.note = "إجراء اختبار تلقائي"
        step.acted_at = acted_at
        if step.step_order in snapshots:
            snapshots[step.step_order].status = "approved" if step.action == ApprovalAction.APPROVED else str(step.action)
            snapshots[step.step_order].action_by = actor.id if actor else None
            snapshots[step.step_order].action_at = acted_at
            snapshots[step.step_order].comments = step.note
        acted_at += timedelta(hours=random.randint(1, 8))

    if scenario == "closed":
        request.status = RequestStatus.CLOSED
        request.closed_at = acted_at
    elif scenario == "implementation":
        request.status = RequestStatus.IN_IMPLEMENTATION
    elif scenario == "first_approved":
        request.status = RequestStatus.PENDING_APPROVAL

    for step in steps:
        if step.action == ApprovalAction.PENDING and step.step_order in snapshots:
            snapshots[step.step_order].status = "pending" if step == next((item for item in steps if item.action == ApprovalAction.PENDING), step) else "waiting"


def create_requests(db: Session, users: list[User], count: int) -> list[ServiceRequest]:
    request_types = active_request_types(db)
    employees = [user for user in users if user.role in {UserRole.EMPLOYEE, UserRole.DIRECT_MANAGER}]
    created: list[ServiceRequest] = []
    scenarios = ["pending", "first_approved", "implementation", "closed", "returned", "rejected"]
    for index in range(1, count + 1):
        requester = random.choice(employees)
        request_type = random.choice(request_types)
        request_enum = request_enum_for_type(request_type)
        assigned_section = request_type.assigned_section or random.choice(SECTIONS)
        created_at = datetime.now(timezone.utc) - timedelta(days=random.randint(0, 45), hours=random.randint(0, 23))
        service_request = ServiceRequest(
            request_number=next_test_request_number(db),
            title=f"[LT] طلب اختبار {index:03d} - {request_type.name_ar}",
            request_type=request_enum,
            request_type_id=request_type.id,
            requester_id=requester.id,
            department_id=requester.department_id or request_type.assigned_department_id,
            status=RequestStatus.PENDING_APPROVAL,
            priority=random.choice([Priority.LOW, Priority.MEDIUM, Priority.HIGH, Priority.CRITICAL]),
            form_data={
                "request_type_label": request_type.name_ar,
                "assigned_section": assigned_section,
                "assigned_section_label": section_label(db, assigned_section),
                "reason": "بيانات اختبار لمحاكاة ضغط العمل",
                "target_user": requester.full_name_ar,
            },
            business_justification="محاكاة عمل لاختبار الأداء وسير الموافقات.",
            created_at=created_at,
            updated_at=created_at,
        )
        db.add(service_request)
        db.flush()
        try:
            create_snapshot_steps(db, service_request, request_type.id)
        except Exception:
            create_fallback_steps(db, service_request)
        db.flush()
        simulate_workflow(service_request, users, random.choice(scenarios))
        service_request.updated_at = created_at + timedelta(hours=random.randint(1, 72))
        created.append(service_request)
        if index % 50 == 0:
            db.flush()
    db.commit()
    return created


def create_messages(db: Session, users: list[User], requests: list[ServiceRequest], count: int) -> None:
    senders = [user for user in users if user.is_active]
    for index in range(1, count + 1):
        sender = random.choice(senders)
        recipients = random.sample([user for user in users if user.id != sender.id], k=random.randint(1, min(5, len(users) - 1)))
        related_request = random.choice(requests) if requests and random.random() < 0.45 else None
        message = InternalMessage(
            message_uid=generate_message_uid(db),
            sender_id=sender.id,
            message_type=random.choice(MESSAGE_TYPES),
            subject=f"[LT] مراسلة اختبار {index:03d}",
            body="هذه رسالة اختبار داخلية لمحاكاة استخدام النظام.\n\nيرجى تجاهلها في بيئة التطوير.",
            related_request_id=related_request.id if related_request else None,
            is_draft=random.random() < 0.08,
            created_at=datetime.now(timezone.utc) - timedelta(days=random.randint(0, 30), minutes=random.randint(1, 900)),
        )
        db.add(message)
        db.flush()
        if not message.is_draft:
            for recipient in recipients:
                is_read = random.random() < 0.55
                db.add(
                    InternalMessageRecipient(
                        message_id=message.id,
                        recipient_id=recipient.id,
                        is_read=is_read,
                        read_at=datetime.now(timezone.utc) - timedelta(days=random.randint(0, 20)) if is_read else None,
                    )
                )
        if index % 75 == 0:
            db.flush()
    db.commit()


def main() -> None:
    args = parse_args()
    random.seed(args.seed)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_database(db)
        ensure_runtime_columns(db)
        db.commit()
        if args.clean:
            reset_test_data(db)
        users = ensure_test_users(db, max(1, args.users))
        requests = create_requests(db, users, max(0, args.requests))
        create_messages(db, users, requests, max(0, args.messages))
        print(
            "\n".join(
                [
                    "Load-test data is ready.",
                    f"Users: {len(users)}",
                    f"Requests created: {len(requests)}",
                    f"Messages created: {args.messages}",
                    f"Test login sample: lt.user0001@{TEST_EMAIL_DOMAIN} / {TEST_PASSWORD}",
                    "All generated users use employee_id prefix LT-.",
                ]
            )
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
