from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.enums import ApprovalAction, Priority, RequestStatus, UserRole
from app.models.message import InternalMessage, InternalMessageRecipient
from app.models.request import ApprovalStep, RequestApprovalStep, ServiceRequest
from app.models.settings import PortalSetting
from app.models.user import Department, Role, User
from app.services.workflow import DEPARTMENT_SPECIALIST_STEP, IMPLEMENTATION_STEP_ROLES

MESSAGE_DEFAULT_ROLES = {
    UserRole.EMPLOYEE,
    UserRole.DIRECT_MANAGER,
    UserRole.IT_STAFF,
    UserRole.DEPARTMENT_MANAGER,
    UserRole.INFOSEC,
    UserRole.EXECUTIVE,
    UserRole.SUPER_ADMIN,
}

PRIORITY_LABELS = {"low": "منخفضة", "medium": "متوسطة", "high": "عالية", "critical": "حرجة"}
STATUS_LABELS = {
    "draft": "مسودة",
    "submitted": "مرسل",
    "pending_approval": "بانتظار الموافقة",
    "approved": "معتمد",
    "rejected": "مرفوض",
    "in_implementation": "قيد التنفيذ",
    "completed": "مكتمل",
    "closed": "مغلق",
    "cancelled": "ملغي",
}


def user_has_messages_screen(db: Session, user: User) -> bool:
    setting = db.scalar(select(PortalSetting).where(PortalSetting.category == "screen_permissions", PortalSetting.setting_key == str(user.id)))
    if not setting:
        return user.role in MESSAGE_DEFAULT_ROLES
    value = setting.setting_value if isinstance(setting.setting_value, dict) else {}
    screens = value.get("screens", [])
    if not isinstance(screens, list):
        return False
    if "messages_permission_initialized" not in value and user.role in MESSAGE_DEFAULT_ROLES:
        return True
    return "messages" in screens


def first_request_notification_recipients(db: Session, service_request: ServiceRequest, actor: User) -> list[User]:
    first_snapshot = pending_snapshot_step(db, service_request)
    first_approval = pending_approval_step(db, service_request)
    return step_notification_recipients(db, service_request, actor, first_snapshot, first_approval)


def pending_snapshot_step(db: Session, service_request: ServiceRequest) -> RequestApprovalStep | None:
    return db.scalar(
        select(RequestApprovalStep)
        .where(RequestApprovalStep.request_id == service_request.id, RequestApprovalStep.status == "pending")
        .order_by(RequestApprovalStep.sort_order)
        .limit(1)
    )


def pending_approval_step(db: Session, service_request: ServiceRequest) -> ApprovalStep | None:
    return db.scalar(
        select(ApprovalStep)
        .where(ApprovalStep.request_id == service_request.id, ApprovalStep.action == ApprovalAction.PENDING)
        .order_by(ApprovalStep.step_order)
        .limit(1)
    )


def step_notification_recipients(
    db: Session,
    service_request: ServiceRequest,
    actor: User,
    snapshot_step: RequestApprovalStep | None,
    approval_step: ApprovalStep | None,
) -> list[User]:
    recipient_ids: set[int] = set()

    if snapshot_step and snapshot_step.approver_user_id:
        recipient_ids.add(snapshot_step.approver_user_id)

    role_value = str(snapshot_step.step_type if snapshot_step else approval_step.role if approval_step else "")
    if role_value == UserRole.DIRECT_MANAGER.value:
        manager_id = actor.manager_id or (service_request.requester.manager_id if service_request.requester else None)
        if manager_id:
            recipient_ids.add(manager_id)
    elif role_value == "department_manager":
        department = service_request.department or (db.get(Department, service_request.department_id) if service_request.department_id else None)
        if department and department.manager_id:
            recipient_ids.add(department.manager_id)
    elif role_value == DEPARTMENT_SPECIALIST_STEP:
        department = service_request.department or (db.get(Department, service_request.department_id) if service_request.department_id else None)
        if department:
            stmt = select(User).where(User.is_active == True, User.department_id == department.id)
            if department.manager_id:
                stmt = stmt.where(User.id != department.manager_id)
            recipient_ids.update(user.id for user in db.scalars(stmt).all())
    elif role_value == "specific_user" and snapshot_step and snapshot_step.approver_user_id:
        recipient_ids.add(snapshot_step.approver_user_id)
    elif role_value == "specific_role" and snapshot_step and snapshot_step.approver_role_id:
        role = db.get(Role, snapshot_step.approver_role_id)
        stmt = select(User).where(User.is_active == True)
        if role and role.code:
            stmt = stmt.where(or_(User.role_id == role.id, User.role == role.code))
        else:
            stmt = stmt.where(User.role_id == snapshot_step.approver_role_id)
        recipient_ids.update(user.id for user in db.scalars(stmt).all())
    elif role_value in IMPLEMENTATION_STEP_ROLES:
        form_data = service_request.form_data or {}
        request_section = form_data.get("assigned_section") or form_data.get("administrative_section")
        stmt = select(User).where(User.is_active == True, User.role.in_([UserRole.IT_STAFF, UserRole.DEPARTMENT_MANAGER]))
        if request_section:
            stmt = stmt.where(or_(User.role == UserRole.DEPARTMENT_MANAGER, User.administrative_section == request_section))
        recipient_ids.update(user.id for user in db.scalars(stmt).all())
    elif role_value:
        try:
            role = UserRole(role_value)
            recipient_ids.update(user.id for user in db.scalars(select(User).where(User.is_active == True, User.role == role)).all())
        except ValueError:
            recipient_ids.update(user.id for user in db.scalars(select(User).where(User.is_active == True, User.role == UserRole.DEPARTMENT_MANAGER)).all())

    if not recipient_ids and actor.manager_id:
        recipient_ids.add(actor.manager_id)
    recipient_ids.discard(actor.id)
    if not recipient_ids:
        return []
    users = db.scalars(select(User).where(User.id.in_(sorted(recipient_ids)), User.is_active == True)).all()
    return [user for user in users if user_has_messages_screen(db, user)]


def requester_recipient(db: Session, service_request: ServiceRequest, actor: User) -> list[User]:
    if service_request.requester_id == actor.id:
        return []
    requester = service_request.requester or db.get(User, service_request.requester_id)
    if not requester or not requester.is_active or not user_has_messages_screen(db, requester):
        return []
    return [requester]


def send_request_message(
    db: Session,
    service_request: ServiceRequest,
    actor: User,
    recipients: list[User],
    message_type: str,
    subject: str,
    body: str,
) -> None:
    clean_recipients = [recipient for recipient in recipients if recipient.id != actor.id and user_has_messages_screen(db, recipient)]
    if not clean_recipients:
        return
    existing = db.scalar(
        select(InternalMessage.id)
        .where(InternalMessage.related_request_id == service_request.id, InternalMessage.message_type == message_type, InternalMessage.subject == subject)
        .limit(1)
    )
    if existing:
        return
    message = InternalMessage(sender_id=actor.id, message_type=message_type, subject=subject, body=body, related_request_id=service_request.id)
    db.add(message)
    db.flush()
    message.thread_id = message.id
    for recipient in clean_recipients:
        db.add(InternalMessageRecipient(message_id=message.id, recipient_id=recipient.id))


def create_request_created_message(db: Session, service_request: ServiceRequest, actor: User) -> None:
    subject = f"إشعار بطلب جديد: {service_request.request_number}"
    existing = db.scalar(
        select(InternalMessage.id)
        .where(InternalMessage.related_request_id == service_request.id, InternalMessage.message_type == "notification", InternalMessage.subject == subject)
        .limit(1)
    )
    if existing:
        return
    recipients = first_request_notification_recipients(db, service_request, actor)
    if not recipients:
        return
    form_data = service_request.form_data or {}
    request_type_label = form_data.get("request_type_label") or str(service_request.request_type)
    priority = PRIORITY_LABELS.get(str(service_request.priority), str(service_request.priority or "-"))
    status_label = STATUS_LABELS.get(str(service_request.status), str(service_request.status or "-"))
    body = "\n".join(
        [
            "تم إنشاء طلب جديد ويحتاج إلى المتابعة.",
            "",
            f"رقم الطلب: {service_request.request_number}",
            f"عنوان الطلب: {service_request.title}",
            f"نوع الطلب: {request_type_label}",
            f"الأولوية: {priority}",
            f"الحالة: {status_label}",
            f"مقدم الطلب: {actor.full_name_ar or actor.email}",
            "",
            f"مبرر الطلب: {service_request.business_justification or '-'}",
        ]
    )
    send_request_message(db, service_request, actor, recipients, "notification", subject, body)


def create_request_workflow_message(db: Session, service_request: ServiceRequest, actor: User, action: ApprovalAction, note: str | None = None) -> None:
    request_number = service_request.request_number
    actor_name = actor.full_name_ar or actor.email
    note_text = note or "-"

    if action == ApprovalAction.RETURNED_FOR_EDIT:
        subject = f"طلب استيضاح/تعديل: {request_number}"
        body = "\n".join(
            [
                "تم إرجاع الطلب للتعديل أو الاستيضاح.",
                "",
                f"رقم الطلب: {request_number}",
                f"عنوان الطلب: {service_request.title}",
                f"بواسطة: {actor_name}",
                f"الملاحظة: {note_text}",
            ]
        )
        send_request_message(db, service_request, actor, requester_recipient(db, service_request, actor), "clarification_request", subject, body)
        return

    if action == ApprovalAction.REJECTED:
        subject = f"سبب رفض الطلب: {request_number}"
        body = "\n".join(
            [
                "تم رفض الطلب.",
                "",
                f"رقم الطلب: {request_number}",
                f"عنوان الطلب: {service_request.title}",
                f"بواسطة: {actor_name}",
                f"سبب الرفض: {note_text}",
            ]
        )
        send_request_message(db, service_request, actor, requester_recipient(db, service_request, actor), "rejection_reason", subject, body)
        return

    if action != ApprovalAction.APPROVED:
        return

    approval_subject = f"ملاحظة موافقة: {request_number}"
    approval_body = "\n".join(
        [
            "تمت الموافقة على مرحلة في مسار الطلب.",
            "",
            f"رقم الطلب: {request_number}",
            f"عنوان الطلب: {service_request.title}",
            f"بواسطة: {actor_name}",
            f"الملاحظة: {note_text}",
        ]
    )
    send_request_message(db, service_request, actor, requester_recipient(db, service_request, actor), "approval_note", approval_subject, approval_body)

    next_snapshot = pending_snapshot_step(db, service_request)
    next_approval = pending_approval_step(db, service_request)
    if not next_snapshot and not next_approval:
        subject = f"إشعار إغلاق الطلب: {request_number}"
        body = "\n".join(
            [
                "تم إغلاق الطلب بعد اكتمال مسار الموافقات.",
                "",
                f"رقم الطلب: {request_number}",
                f"عنوان الطلب: {service_request.title}",
                f"آخر إجراء بواسطة: {actor_name}",
            ]
        )
        send_request_message(db, service_request, actor, requester_recipient(db, service_request, actor), "notification", subject, body)
        return

    next_role = str(next_snapshot.step_type if next_snapshot else next_approval.role if next_approval else "")
    next_step_label = (
        next_snapshot.step_name_ar
        if next_snapshot and next_snapshot.step_name_ar
        else {
            UserRole.DIRECT_MANAGER.value: "المدير المباشر",
            "department_manager": "مدير الإدارة المختصة",
            DEPARTMENT_SPECIALIST_STEP: "مختص الإدارة المختصة",
            UserRole.INFOSEC.value: "أمن المعلومات (مرحلة قديمة)",
            UserRole.DEPARTMENT_MANAGER.value: "مدير إدارة",
            UserRole.IT_STAFF.value: "مختص تنفيذ",
        }.get(next_role, next_role or "المرحلة التالية")
    )
    recipients = step_notification_recipients(db, service_request, actor, next_snapshot, next_approval)
    subject = f"انتقال طلب للمتابعة: {request_number} - {next_step_label}"
    body = "\n".join(
        [
            "انتقل الطلب إلى مرحلتك في مسار الموافقات.",
            "",
            f"رقم الطلب: {request_number}",
            f"عنوان الطلب: {service_request.title}",
            f"المرحلة الحالية: {next_step_label}",
            f"الإجراء السابق بواسطة: {actor_name}",
        ]
    )
    send_request_message(db, service_request, actor, recipients, "notification", subject, body)
