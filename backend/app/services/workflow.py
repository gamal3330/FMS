from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.enums import ApprovalAction, RequestStatus, RequestType, UserRole
from app.models.request import ApprovalStep, ServiceRequest
from app.models.user import User

WORKFLOW_CHAINS: dict[RequestType, list[UserRole | str]] = {
    RequestType.EMAIL: [UserRole.DIRECT_MANAGER, UserRole.IT_MANAGER, "implementation"],
    RequestType.DOMAIN: [UserRole.DIRECT_MANAGER, UserRole.IT_MANAGER, "implementation"],
    RequestType.VPN: [UserRole.DIRECT_MANAGER, UserRole.INFOSEC, UserRole.IT_MANAGER, "implementation"],
    RequestType.INTERNET: [UserRole.DIRECT_MANAGER, UserRole.INFOSEC, UserRole.IT_MANAGER, "implementation"],
    RequestType.DATA_COPY: [
        UserRole.DIRECT_MANAGER,
        UserRole.INFOSEC,
        UserRole.IT_MANAGER,
        UserRole.EXECUTIVE,
        "execution",
    ],
    RequestType.NETWORK: [UserRole.DIRECT_MANAGER, UserRole.INFOSEC, UserRole.IT_MANAGER, "implementation"],
    RequestType.COMPUTER_MOVE: [UserRole.DIRECT_MANAGER, UserRole.IT_MANAGER, "implementation"],
    RequestType.SUPPORT: [UserRole.IT_STAFF, "implementation"],
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


def user_can_act(user: User, step: ApprovalStep) -> bool:
    return user.role == UserRole.SUPER_ADMIN or step.role == user.role or step.role in IMPLEMENTATION_STEP_ROLES and user.role in {
        UserRole.IT_STAFF,
        UserRole.IT_MANAGER,
    }


def advance_workflow(db: Session, request: ServiceRequest, actor: User, action: ApprovalAction, note: str | None) -> ApprovalStep:
    pending_step = next((step for step in sorted(request.approvals, key=lambda item: item.step_order) if step.action == ApprovalAction.PENDING), None)
    if pending_step is None:
        raise ValueError("No pending approval step")
    if not user_can_act(actor, pending_step):
        raise PermissionError("User cannot act on current step")

    pending_step.action = action
    pending_step.approver_id = actor.id
    pending_step.note = note
    pending_step.acted_at = datetime.now(timezone.utc)

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
