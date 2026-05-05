from sqlalchemy import text


def upgrade(connection):
    indexes = [
        ("idx_service_requests_status_created", "service_requests", "status, created_at"),
        ("idx_service_requests_requester_created", "service_requests", "requester_id, created_at"),
        ("idx_service_requests_department_created", "service_requests", "department_id, created_at"),
        ("idx_approval_steps_role_action", "approval_steps", "role, action"),
        ("idx_approval_steps_request_action", "approval_steps", "request_id, action"),
        ("idx_request_approval_steps_status_order", "request_approval_steps", "request_id, status, sort_order"),
        ("idx_audit_logs_created_action", "audit_logs", "created_at, action"),
        ("idx_users_role_active", "users", "role, is_active"),
    ]
    for name, table, columns in indexes:
        connection.execute(text(f'CREATE INDEX IF NOT EXISTS "{name}" ON "{table}" ({columns})'))
