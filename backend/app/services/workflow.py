from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.enums import ApprovalAction, RequestStatus, RequestType, UserRole
from app.models.request import ApprovalStep, RequestApprovalStep, ServiceRequest
from app.models.settings import WorkflowTemplate, WorkflowTemplateStep
from app.models.user import Department, Role, User, UserDelegation

DEPARTMENT_SPECIALIST_STEP = "department_specialist"

WORKFLOW_CHAINS: dict[RequestType, list[UserRole | str]] = {
    RequestType.EMAIL: [UserRole.DIRECT_MANAGER, "department_manager", DEPARTMENT_SPECIALIST_STEP],
    RequestType.DOMAIN: [UserRole.DIRECT_MANAGER, "department_manager", DEPARTMENT_SPECIALIST_STEP],
    RequestType.VPN: [UserRole.DIRECT_MANAGER, UserRole.INFOSEC, "department_manager", DEPARTMENT_SPECIALIST_STEP],
    RequestType.INTERNET: [UserRole.DIRECT_MANAGER, UserRole.INFOSEC, "department_manager"],
    RequestType.DATA_COPY: [
        UserRole.DIRECT_MANAGER,
        UserRole.INFOSEC,
        "department_manager",
        UserRole.EXECUTIVE,
        DEPARTMENT_SPECIALIST_STEP,
    ],
    RequestType.NETWORK: [UserRole.DIRECT_MANAGER, UserRole.INFOSEC, "department_manager", DEPARTMENT_SPECIALIST_STEP],
    RequestType.COMPUTER_MOVE: [UserRole.DIRECT_MANAGER, "department_manager", DEPARTMENT_SPECIALIST_STEP],
    RequestType.SUPPORT: [DEPARTMENT_SPECIALIST_STEP],
}

SLA_HOURS = {
    RequestType.SUPPORT: 8,
    RequestType.EMAIL: 16,
    RequestType.DOMAIN: 16,
    RequestType.VPN: 24,
    RequestType.INTERNET: 24,
    RequestType.DATA_COPY: 48,
    RequestType.NETWORK: 48,
    RequestType.COMPUTER_MOVE: 24,
}

IMPLEMENTATION_STEP_ROLES = {"implementation", "execution", "implementation_engineer", "close_request"}


def next_request_number(db: Session) -> str:
    year = datetime.now(timezone.utc).year
    count = db.scalar(select(func.count()).select_from(ServiceRequest).where(ServiceRequest.request_number.like(f"QIB-{year}-%")))
    sequence = (count or 0) + 1
    return f"QIB-{year}-{sequence:06d}"


def create_approval_steps(db: Session, service_request: ServiceRequest) -> None:
    chain = WORKFLOW_CHAINS[service_request.request_type]
    for index, role in enumerate(chain, start=1):
        db.add(ApprovalStep(request=service_request, step_order=index, role=str(role), action=ApprovalAction.PENDING))
    service_request.status = RequestStatus.PENDING_APPROVAL
    service_request.sla_due_at = datetime.now(timezone.utc) + timedelta(hours=SLA_HOURS[service_request.request_type])


def active_approval_delegators(db: Session, user: User) -> list[User]:
    now = datetime.now(timezone.utc)
    return db.scalars(
        select(User)
        .join(UserDelegation, UserDelegation.delegator_user_id == User.id)
        .where(
            UserDelegation.delegate_user_id == user.id,
            UserDelegation.is_active == True,
            UserDelegation.delegation_scope.in_(["approvals_only", "all_allowed_actions"]),
            UserDelegation.start_date <= now,
            UserDelegation.end_date >= now,
            User.is_active == True,
        )
    ).all()


def _role_id_matches(db: Session, user: User, role_id: int | None) -> bool:
    if not role_id:
        return False
    if user.role_id == role_id:
        return True
    role = db.get(Role, role_id)
    return bool(role and role.code and str(user.role) == role.code)


def _request_department(db: Session, request: ServiceRequest) -> Department | None:
    if request.department:
        return request.department
    if not request.department_id:
        return None
    return db.get(Department, request.department_id)


def _user_matches_step(db: Session, request: ServiceRequest, user: User, step: ApprovalStep, *, allow_super_admin: bool = True) -> bool:
    if allow_super_admin and user.role == UserRole.SUPER_ADMIN:
        return True

    step_type = str(step.role or "")
    snapshot_step = workflow_snapshot_step(request, step) or {}
    approver_user_id = snapshot_step.get("approver_user_id")
    approver_role_id = snapshot_step.get("approver_role_id")

    if approver_user_id:
        return user.id == int(approver_user_id)

    if step_type == "specific_user":
        return False

    if step_type == "specific_role":
        if user.role == UserRole.DEPARTMENT_MANAGER and _role_id_matches(db, user, int(approver_role_id) if approver_role_id else None):
            department = _request_department(db, request)
            return bool(department and department.manager_id == user.id)
        return _role_id_matches(db, user, int(approver_role_id) if approver_role_id else None)

    if step_type == "specific_department_manager":
        target_department_id = snapshot_step.get("target_department_id")
        if not target_department_id:
            return False
        department = db.get(Department, int(target_department_id))
        return bool(department and department.manager_id == user.id)

    if step_type == UserRole.DIRECT_MANAGER.value:
        return bool(request.requester and request.requester.manager_id == user.id)

    if step_type == "department_manager":
        department = _request_department(db, request)
        return bool(department and department.manager_id == user.id)

    if step_type == DEPARTMENT_SPECIALIST_STEP:
        department = _request_department(db, request)
        return bool(
            user.is_active
            and department
            and user.department_id == department.id
            and user.id != department.manager_id
        )

    if step_type in IMPLEMENTATION_STEP_ROLES and user.role == UserRole.IT_STAFF:
        return True

    if step_type == str(user.role):
        if user.role == UserRole.DEPARTMENT_MANAGER:
            department = _request_department(db, request)
            return bool(department and department.manager_id == user.id)
        return True

    return False


def user_can_act(db: Session, request: ServiceRequest, user: User, step: ApprovalStep) -> bool:
    if _user_matches_step(db, request, user, step):
        return True

    for delegator in active_approval_delegators(db, user):
        if _user_matches_step(db, request, delegator, step, allow_super_admin=False):
            return True
    return False


def workflow_return_config(db: Session, request: ServiceRequest, step: ApprovalStep) -> tuple[bool, int | None]:
    snapshot_step = workflow_snapshot_step(request, step)
    if snapshot_step and "can_return_for_edit" in snapshot_step:
        return bool(snapshot_step.get("can_return_for_edit")), snapshot_step.get("return_to_step_order")

    if not request.request_type_id:
        return False, None
    row = db.execute(
        select(WorkflowTemplateStep.can_return_for_edit, WorkflowTemplateStep.return_to_step_order)
        .join(WorkflowTemplate, WorkflowTemplateStep.workflow_template_id == WorkflowTemplate.id)
        .where(
            WorkflowTemplate.request_type_id == request.request_type_id,
            WorkflowTemplate.is_active == True,
            WorkflowTemplateStep.is_active == True,
            WorkflowTemplateStep.sort_order == step.step_order,
            WorkflowTemplateStep.step_type == step.role,
        )
        .limit(1)
    ).first()
    if not row:
        return False, None
    return bool(row.can_return_for_edit), row.return_to_step_order


def workflow_snapshot_step(request: ServiceRequest, step: ApprovalStep) -> dict | None:
    workflow = (request.request_type_snapshot or {}).get("workflow") or []
    for item in workflow:
        if int(item.get("sort_order") or 0) == step.step_order and str(item.get("step_type") or "") == str(step.role):
            return item
    return None


def step_can_reject(db: Session, request: ServiceRequest, step: ApprovalStep) -> bool:
    snapshot_step = workflow_snapshot_step(request, step)
    if snapshot_step and "can_reject" in snapshot_step:
        return bool(snapshot_step.get("can_reject"))

    if not request.request_type_id:
        return True
    row = db.execute(
        select(WorkflowTemplateStep.can_reject)
        .join(WorkflowTemplate, WorkflowTemplateStep.workflow_template_id == WorkflowTemplate.id)
        .where(
            WorkflowTemplate.request_type_id == request.request_type_id,
            WorkflowTemplate.is_active == True,
            WorkflowTemplateStep.is_active == True,
            WorkflowTemplateStep.sort_order == step.step_order,
            WorkflowTemplateStep.step_type == step.role,
        )
        .limit(1)
    ).first()
    return True if not row else bool(row.can_reject)


def step_can_return_for_edit(db: Session, request: ServiceRequest, step: ApprovalStep) -> bool:
    can_return, _ = workflow_return_config(db, request, step)
    return can_return


def return_workflow_to_step(request: ServiceRequest, target_order: int) -> None:
    target_exists = any(step.step_order == target_order for step in request.approvals)
    if not target_exists:
        raise ValueError("Selected return target step is not available")

    for step in request.approvals:
        if step.step_order >= target_order:
            step.action = ApprovalAction.PENDING
            step.approver_id = None
            step.note = None
            step.acted_at = None

    for snapshot in request.approval_snapshots:
        if snapshot.sort_order < target_order:
            continue
        snapshot.status = "pending" if snapshot.sort_order == target_order else "waiting"
        snapshot.action_by = None
        snapshot.action_at = None
        snapshot.comments = None

    request.status = RequestStatus.PENDING_APPROVAL
    request.closed_at = None


def sync_snapshot_action(request: ServiceRequest, step: ApprovalStep, actor: User, action: ApprovalAction, note: str | None) -> None:
    snapshots = sorted(request.approval_snapshots or [], key=lambda item: item.sort_order)
    current_snapshot = next((item for item in snapshots if item.sort_order == step.step_order), None)
    if current_snapshot:
        current_snapshot.status = str(action)
        current_snapshot.action_by = actor.id
        current_snapshot.action_at = step.acted_at
        current_snapshot.comments = note

    if action != ApprovalAction.APPROVED:
        return

    next_snapshot = next((item for item in snapshots if item.sort_order > step.step_order and item.status in {"waiting", "pending"}), None)
    if next_snapshot:
        next_snapshot.status = "pending"


def reset_workflow_for_resubmission(request: ServiceRequest) -> None:
    for step in request.approvals:
        step.action = ApprovalAction.PENDING
        step.approver_id = None
        step.note = None
        step.acted_at = None
    for snapshot in request.approval_snapshots:
        snapshot.status = "pending" if snapshot.sort_order == min((item.sort_order for item in request.approval_snapshots), default=snapshot.sort_order) else "waiting"
        snapshot.action_by = None
        snapshot.action_at = None
        snapshot.comments = None
    request.status = RequestStatus.PENDING_APPROVAL
    request.closed_at = None
    request.sla_due_at = datetime.now(timezone.utc) + timedelta(hours=SLA_HOURS.get(request.request_type, 24))


def advance_workflow(db: Session, request: ServiceRequest, actor: User, action: ApprovalAction, note: str | None) -> ApprovalStep:
    pending_step = next((step for step in sorted(request.approvals, key=lambda item: item.step_order) if step.action == ApprovalAction.PENDING), None)
    if pending_step is None:
        raise ValueError("No pending approval step")
    if not user_can_act(db, request, actor, pending_step):
        raise PermissionError("User cannot act on current step")
    return_target_order = None
    if action == ApprovalAction.RETURNED_FOR_EDIT:
        can_return, return_target_order = workflow_return_config(db, request, pending_step)
        if not can_return:
            raise PermissionError("This step cannot return the request for editing")
    if action == ApprovalAction.REJECTED and not step_can_reject(db, request, pending_step):
        raise PermissionError("هذه المرحلة لا تسمح بالرفض حسب إعدادات مسار الموافقات")

    pending_step.action = action
    pending_step.approver_id = actor.id
    pending_step.note = note
    pending_step.acted_at = datetime.now(timezone.utc)
    sync_snapshot_action(request, pending_step, actor, action, note)

    if action == ApprovalAction.RETURNED_FOR_EDIT:
        if return_target_order:
            return_workflow_to_step(request, return_target_order)
        else:
            request.status = RequestStatus.RETURNED_FOR_EDIT
            request.closed_at = None
        return pending_step

    if action == ApprovalAction.REJECTED:
        request.status = RequestStatus.REJECTED
        return pending_step

    has_pending = any(step.action == ApprovalAction.PENDING for step in request.approvals if step.id != pending_step.id)
    if not has_pending:
        request.status = RequestStatus.CLOSED
        request.closed_at = datetime.now(timezone.utc)
    elif pending_step.role in IMPLEMENTATION_STEP_ROLES:
        request.status = RequestStatus.IN_IMPLEMENTATION
    else:
        request.status = RequestStatus.PENDING_APPROVAL
    return pending_step
