CREATE TABLE departments (
    id SERIAL PRIMARY KEY,
    name_ar VARCHAR(120) NOT NULL UNIQUE,
    name_en VARCHAR(120) NOT NULL UNIQUE,
    code VARCHAR(30) UNIQUE,
    manager_id INTEGER,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(80) NOT NULL UNIQUE,
    label_ar VARCHAR(120) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    employee_id VARCHAR(40) NOT NULL UNIQUE,
    username VARCHAR(80) UNIQUE,
    full_name_ar VARCHAR(160) NOT NULL,
    full_name_en VARCHAR(160) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    mobile VARCHAR(40),
    hashed_password VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    department_id INTEGER REFERENCES departments(id),
    manager_id INTEGER REFERENCES users(id),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE departments
    ADD CONSTRAINT fk_departments_manager_id FOREIGN KEY (manager_id) REFERENCES users(id);

CREATE TABLE service_requests (
    id SERIAL PRIMARY KEY,
    request_number VARCHAR(32) NOT NULL UNIQUE,
    title VARCHAR(180) NOT NULL,
    request_type VARCHAR(60) NOT NULL,
    request_type_id INTEGER,
    status VARCHAR(40) NOT NULL DEFAULT 'submitted',
    priority VARCHAR(20) NOT NULL DEFAULT 'medium',
    requester_id INTEGER NOT NULL REFERENCES users(id),
    department_id INTEGER REFERENCES departments(id),
    form_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    business_justification TEXT,
    sla_due_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE approval_steps (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL,
    role VARCHAR(60) NOT NULL,
    approver_id INTEGER REFERENCES users(id),
    action VARCHAR(20) NOT NULL DEFAULT 'pending',
    note TEXT,
    acted_at TIMESTAMPTZ,
    UNIQUE (request_id, step_order)
);

CREATE TABLE request_comments (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
    author_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    is_internal BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE attachments (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
    uploaded_by_id INTEGER NOT NULL REFERENCES users(id),
    original_name VARCHAR(255) NOT NULL,
    stored_name VARCHAR(255) NOT NULL UNIQUE,
    content_type VARCHAR(120) NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    title VARCHAR(180) NOT NULL,
    body TEXT NOT NULL,
    channel VARCHAR(30) NOT NULL DEFAULT 'in_app',
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    actor_id INTEGER REFERENCES users(id),
    action VARCHAR(80) NOT NULL,
    entity_type VARCHAR(80) NOT NULL,
    entity_id VARCHAR(80),
    ip_address VARCHAR(64),
    user_agent VARCHAR(255),
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE settings_general (
    id SERIAL PRIMARY KEY,
    system_name VARCHAR(160) NOT NULL DEFAULT 'QIB IT Service Portal',
    language VARCHAR(20) NOT NULL DEFAULT 'Arabic',
    session_timeout_minutes INTEGER NOT NULL DEFAULT 60,
    upload_max_file_size_mb INTEGER NOT NULL DEFAULT 10,
    allowed_file_extensions VARCHAR(255) NOT NULL DEFAULT 'pdf,docx,xlsx,png,jpg',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workflow_templates (
    id SERIAL PRIMARY KEY,
    request_type VARCHAR(80) UNIQUE,
    request_type_id INTEGER REFERENCES request_types(id),
    name VARCHAR(160) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workflow_steps (
    id SERIAL PRIMARY KEY,
    workflow_template_id INTEGER NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL,
    approver_role VARCHAR(80) NOT NULL,
    is_mandatory BOOLEAN NOT NULL DEFAULT true,
    sla_hours INTEGER NOT NULL DEFAULT 8
);

CREATE TABLE request_types (
    id SERIAL PRIMARY KEY,
    request_type VARCHAR(80) UNIQUE,
    label_ar VARCHAR(160),
    name_ar VARCHAR(160) NOT NULL,
    name_en VARCHAR(160) NOT NULL,
    code VARCHAR(60) NOT NULL UNIQUE,
    category VARCHAR(80) NOT NULL,
    description TEXT,
    icon VARCHAR(80),
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    is_active BOOLEAN NOT NULL DEFAULT true,
    require_attachment BOOLEAN DEFAULT false,
    requires_attachment BOOLEAN NOT NULL DEFAULT false,
    allow_multiple_attachments BOOLEAN NOT NULL DEFAULT false,
    default_priority VARCHAR(20) NOT NULL DEFAULT 'medium',
    sla_response_hours INTEGER NOT NULL DEFAULT 4,
    sla_resolution_hours INTEGER NOT NULL DEFAULT 24,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE request_type_fields (
    id SERIAL PRIMARY KEY,
    request_type_id INTEGER NOT NULL REFERENCES request_types(id) ON DELETE CASCADE,
    label_ar VARCHAR(160) NOT NULL,
    label_en VARCHAR(160) NOT NULL,
    field_name VARCHAR(100) NOT NULL,
    field_type VARCHAR(40) NOT NULL,
    is_required BOOLEAN NOT NULL DEFAULT false,
    placeholder VARCHAR(255),
    help_text TEXT,
    validation_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    sort_order INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT true,
    UNIQUE (request_type_id, field_name)
);

CREATE TABLE workflow_template_steps (
    id SERIAL PRIMARY KEY,
    workflow_template_id INTEGER NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
    step_name_ar VARCHAR(160) NOT NULL,
    step_name_en VARCHAR(160) NOT NULL,
    step_type VARCHAR(80) NOT NULL,
    approver_role_id INTEGER REFERENCES roles(id),
    approver_user_id INTEGER REFERENCES users(id),
    is_mandatory BOOLEAN NOT NULL DEFAULT true,
    can_reject BOOLEAN NOT NULL DEFAULT true,
    can_return_for_edit BOOLEAN NOT NULL DEFAULT false,
    sla_hours INTEGER NOT NULL DEFAULT 8,
    escalation_user_id INTEGER REFERENCES users(id),
    sort_order INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE request_approval_steps (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
    step_name_ar VARCHAR(160) NOT NULL,
    step_name_en VARCHAR(160) NOT NULL,
    step_type VARCHAR(80) NOT NULL,
    approver_role_id INTEGER REFERENCES roles(id),
    approver_user_id INTEGER REFERENCES users(id),
    status VARCHAR(30) NOT NULL DEFAULT 'waiting',
    action_by INTEGER REFERENCES users(id),
    action_at TIMESTAMPTZ,
    comments TEXT,
    sla_due_at TIMESTAMPTZ,
    sort_order INTEGER NOT NULL
);

ALTER TABLE service_requests
    ADD CONSTRAINT fk_service_requests_request_type_id FOREIGN KEY (request_type_id) REFERENCES request_types(id);

CREATE TABLE notification_settings (
    id SERIAL PRIMARY KEY,
    smtp_host VARCHAR(160),
    smtp_port INTEGER NOT NULL DEFAULT 587,
    smtp_username VARCHAR(160),
    smtp_password VARCHAR(255),
    smtp_tls BOOLEAN NOT NULL DEFAULT true,
    email_approvals BOOLEAN NOT NULL DEFAULT true,
    email_rejections BOOLEAN NOT NULL DEFAULT true,
    request_completed BOOLEAN NOT NULL DEFAULT true,
    daily_summary BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE security_policies (
    id SERIAL PRIMARY KEY,
    password_min_length INTEGER NOT NULL DEFAULT 12,
    require_uppercase BOOLEAN NOT NULL DEFAULT true,
    require_numbers BOOLEAN NOT NULL DEFAULT true,
    require_special_chars BOOLEAN NOT NULL DEFAULT true,
    mfa_enabled BOOLEAN NOT NULL DEFAULT false,
    lock_after_failed_attempts INTEGER NOT NULL DEFAULT 5,
    password_expiry_days INTEGER NOT NULL DEFAULT 90
);

CREATE TABLE sla_rules (
    id SERIAL PRIMARY KEY,
    request_type VARCHAR(80) NOT NULL UNIQUE,
    response_time_hours INTEGER NOT NULL,
    resolution_time_hours INTEGER NOT NULL,
    escalation_user_id INTEGER REFERENCES users(id)
);

CREATE INDEX ix_users_role ON users(role);
CREATE INDEX ix_users_username ON users(username);
CREATE INDEX ix_users_department_id ON users(department_id);
CREATE INDEX ix_departments_code ON departments(code);
CREATE INDEX ix_service_requests_request_type ON service_requests(request_type);
CREATE INDEX ix_service_requests_status ON service_requests(status);
CREATE INDEX ix_service_requests_requester_id ON service_requests(requester_id);
CREATE INDEX ix_service_requests_department_id ON service_requests(department_id);
CREATE INDEX ix_service_requests_created_at ON service_requests(created_at);
CREATE INDEX ix_approval_steps_request_id ON approval_steps(request_id);
CREATE INDEX ix_approval_steps_role ON approval_steps(role);
CREATE INDEX ix_approval_steps_action ON approval_steps(action);
CREATE INDEX ix_attachments_request_id ON attachments(request_id);
CREATE INDEX ix_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX ix_audit_logs_action ON audit_logs(action);
CREATE INDEX ix_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX ix_workflow_templates_request_type ON workflow_templates(request_type);
CREATE INDEX ix_workflow_templates_request_type_id ON workflow_templates(request_type_id);
CREATE INDEX ix_workflow_steps_template_id ON workflow_steps(workflow_template_id);
CREATE INDEX ix_request_types_request_type ON request_types(request_type);
CREATE INDEX ix_request_types_code ON request_types(code);
CREATE INDEX ix_request_type_fields_request_type_id ON request_type_fields(request_type_id);
CREATE INDEX ix_workflow_template_steps_template_id ON workflow_template_steps(workflow_template_id);
CREATE INDEX ix_request_approval_steps_request_id ON request_approval_steps(request_id);
CREATE INDEX ix_sla_rules_request_type ON sla_rules(request_type);
