from enum import StrEnum


class UserRole(StrEnum):
    EMPLOYEE = "employee"
    DIRECT_MANAGER = "direct_manager"
    IT_STAFF = "it_staff"
    IT_MANAGER = "it_manager"
    INFOSEC = "information_security"
    EXECUTIVE = "executive_management"
    SUPER_ADMIN = "super_admin"


class RequestStatus(StrEnum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    PENDING_APPROVAL = "pending_approval"
    RETURNED_FOR_EDIT = "returned_for_edit"
    APPROVED = "approved"
    REJECTED = "rejected"
    IN_IMPLEMENTATION = "in_implementation"
    COMPLETED = "completed"
    CLOSED = "closed"
    CANCELLED = "cancelled"


class Priority(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class RequestType(StrEnum):
    EMAIL = "email"
    DOMAIN = "domain"
    VPN = "vpn_remote_access"
    INTERNET = "internet_access"
    DATA_COPY = "data_copy"
    NETWORK = "network_access"
    COMPUTER_MOVE = "computer_move_installation"
    SUPPORT = "it_support_ticket"


class ApprovalAction(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    RETURNED_FOR_EDIT = "returned_for_edit"
    SKIPPED = "skipped"
