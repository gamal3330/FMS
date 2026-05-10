from datetime import datetime

from sqlalchemy import func, inspect, select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import get_password_hash
from app.models.ai import DEFAULT_AI_SYSTEM_PROMPT
from app.models.enums import UserRole
from app.models.settings import RequestTypeField, RequestTypeSetting, RequestTypeVersion, SpecializedSection, WorkflowTemplate, WorkflowTemplateStep
from app.models.user import Department, Role, User

settings = get_settings()

DEFAULT_DEPARTMENTS = [
    ("تقنية المعلومات", "Information Technology", "IT"),
    ("الخدمات المصرفية للأفراد", "Retail Banking", "RB"),
    ("العمليات", "Operations", "OPS"),
    ("المخاطر والامتثال", "Risk and Compliance", "RISK"),
    ("الموارد البشرية", "Human Resources", "HR"),
]

DEFAULT_ROLES = [
    ("employee", "موظف"),
    ("direct_manager", "مدير مباشر"),
    ("it_staff", "مختص تنفيذ"),
    ("administration_manager", "مدير إدارة"),
    ("executive_management", "الإدارة التنفيذية"),
    ("super_admin", "مدير النظام"),
]

DEFAULT_SPECIALIZED_SECTIONS = [
    ("servers", "قسم السيرفرات", "Servers Section", "طلبات الخوادم والأنظمة والبنية التحتية."),
    ("networks", "قسم الشبكات", "Networks Section", "طلبات الشبكات والاتصالات وصلاحيات الوصول."),
    ("support", "قسم الدعم الفني", "Technical Support Section", "طلبات الدعم اليومي والأجهزة ومساندة المستخدمين."),
    ("development", "وحدة تطوير البرامج", "Software Development Unit", "طلبات التطوير والأنظمة والتكاملات."),
]

DEFAULT_REQUEST_TYPES = [
    ("طلب إيميل", "Email Request", "EMAIL", "accounts", "إدارة طلبات البريد الإلكتروني", 4, 8, ["target_user", "email_action", "reason"], ["Direct Manager", "Department Manager", "Department Specialist"]),
    ("طلب دومين", "Domain Request", "DOMAIN", "accounts", "إدارة مستخدمي الدومين", 4, 8, ["target_user", "domain_action", "reason"], ["Direct Manager", "Department Manager", "Department Specialist"]),
    ("طلب VPN", "VPN Request", "VPN", "access", "طلب وصول آمن عن بعد", 8, 24, ["employee_name", "employee_id", "department", "access_needed", "reason", "start_date", "end_date"], ["Direct Manager", "Information Security", "Department Manager", "Department Specialist"]),
    ("طلب وصول إنترنت", "Internet Access", "INTERNET", "access", "طلب صلاحيات تصفح الإنترنت", 8, 24, ["target_user", "access_level", "reason"], ["Direct Manager", "Information Security", "Department Manager"]),
    ("طلب نسخ بيانات", "Data Copy", "DATA_COPY", "security", "طلب نسخ بيانات إلى وسيط خارجي أو بريد", 8, 48, ["copy_method", "source_location", "destination", "reason"], ["Direct Manager", "Information Security", "Department Manager", "Executive Management", "Department Specialist"]),
    ("طلب وصول عبر شبكة البنك", "Network Access", "NETWORK", "network", "فتح اتصال شبكي بين مصدر ووجهة", 8, 48, ["source_ip", "destination_ip", "destination_port", "nat_port", "reason"], ["Direct Manager", "Information Security", "Department Manager", "Department Specialist"]),
    ("طلب تركيب / نقل جهاز كمبيوتر", "Computer Install/Move", "COMPUTER_MOVE", "hardware", "نقل أو تركيب جهاز كمبيوتر", 4, 24, ["asset_tag", "current_location", "new_location", "reason"], ["Direct Manager", "Department Manager", "Department Specialist"]),
    ("طلب دعم فني", "Support Ticket", "SUPPORT", "support", "تذكرة دعم فني", 2, 8, ["affected_user", "category", "issue_description"], ["Department Specialist"]),
]


def _message_tracking_year(created_at) -> int:
    if isinstance(created_at, datetime):
        return created_at.year
    value = str(created_at or "").strip()
    if len(value) >= 4 and value[:4].isdigit():
        return int(value[:4])
    return datetime.utcnow().year


def ensure_message_tracking_ids(db: Session) -> None:
    used = {
        row[0]
        for row in db.execute(
            text("SELECT message_uid FROM internal_messages WHERE message_uid IS NOT NULL AND message_uid <> ''")
        ).all()
        if row[0]
    }
    counters: dict[int, int] = {}
    rows = db.execute(
        text(
            """
            SELECT id, created_at
            FROM internal_messages
            WHERE message_uid IS NULL OR message_uid = ''
            ORDER BY id
            """
        )
    ).all()
    for message_id, created_at in rows:
        year = _message_tracking_year(created_at)
        counters[year] = counters.get(year, 0) + 1
        message_uid = f"MSG-{year}-{counters[year]:06d}"
        while message_uid in used:
            counters[year] += 1
            message_uid = f"MSG-{year}-{counters[year]:06d}"
        used.add(message_uid)
        db.execute(
            text("UPDATE internal_messages SET message_uid = :message_uid WHERE id = :message_id"),
            {"message_uid": message_uid, "message_id": message_id},
        )


def ensure_sqlite_dev_columns(db: Session) -> None:
    if db.bind and db.bind.dialect.name != "sqlite":
        return
    table_columns = {
        "departments": {
            "code": "VARCHAR(30)",
            "manager_id": "INTEGER",
            "is_active": "BOOLEAN DEFAULT 1",
            "updated_at": "DATETIME",
        },
        "users": {
            "username": "VARCHAR(80)",
            "mobile": "VARCHAR(40)",
            "job_title": "VARCHAR(120)",
            "role_id": "INTEGER",
            "administrative_section": "VARCHAR(40)",
            "specialized_section_id": "INTEGER",
            "relationship_type": "VARCHAR(40) DEFAULT 'employee'",
            "failed_login_attempts": "INTEGER DEFAULT 0",
            "locked_until": "DATETIME",
            "password_changed_at": "DATETIME",
            "password_expires_at": "DATETIME",
            "is_locked": "BOOLEAN DEFAULT 0",
            "force_password_change": "BOOLEAN DEFAULT 0",
            "allowed_login_from_ip": "VARCHAR(255)",
            "notes": "TEXT",
            "last_login_at": "DATETIME",
            "updated_at": "DATETIME",
        },
        "roles": {
            "name_ar": "VARCHAR(120)",
            "name_en": "VARCHAR(120)",
            "code": "VARCHAR(80)",
            "description": "TEXT",
            "is_system_role": "BOOLEAN DEFAULT 1",
            "updated_at": "DATETIME",
        },
        "settings_general": {
            "login_intro_text": "TEXT",
            "logo_url": "VARCHAR(255)",
            "brand_color": "VARCHAR(7) DEFAULT '#0d6337'",
            "timezone": "VARCHAR(80) DEFAULT 'Asia/Qatar'",
        },
        "notification_settings": {
            "smtp_from_email": "VARCHAR(160)",
            "smtp_from_name": "VARCHAR(160)",
        },
        "service_requests": {
            "request_type_id": "INTEGER",
            "request_type_version_id": "INTEGER",
            "request_type_version_number": "INTEGER DEFAULT 1",
            "assigned_to_id": "INTEGER",
            "request_type_snapshot": "JSON DEFAULT '{}'",
            "form_schema_snapshot": "JSON DEFAULT '[]'",
        },
        "request_types": {
            "name_ar": "VARCHAR(160)",
            "name_en": "VARCHAR(160)",
            "code": "VARCHAR(60)",
            "category": "VARCHAR(80)",
            "assigned_section": "VARCHAR(40)",
            "assigned_department_id": "INTEGER",
            "auto_assign_strategy": "VARCHAR(40) DEFAULT 'none'",
            "description": "TEXT",
            "icon": "VARCHAR(80)",
            "is_active": "BOOLEAN DEFAULT 1",
            "requires_attachment": "BOOLEAN DEFAULT 0",
            "allow_multiple_attachments": "BOOLEAN DEFAULT 0",
            "max_attachments": "INTEGER DEFAULT 1",
            "max_file_size_mb": "INTEGER DEFAULT 10",
            "allowed_extensions_json": "JSON DEFAULT '[\"pdf\", \"png\", \"jpg\", \"jpeg\"]'",
            "default_priority": "VARCHAR(20) DEFAULT 'medium'",
            "sla_response_hours": "INTEGER DEFAULT 4",
            "sla_resolution_hours": "INTEGER DEFAULT 24",
            "current_version_number": "INTEGER DEFAULT 1",
            "created_at": "DATETIME",
            "updated_at": "DATETIME",
        },
        "workflow_templates": {
            "request_type_id": "INTEGER",
            "created_at": "DATETIME",
            "updated_at": "DATETIME",
        },
        "specialized_sections": {
            "department_id": "INTEGER",
        },
    }
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS specialized_sections (
                id INTEGER PRIMARY KEY,
                name_ar VARCHAR(120) NOT NULL,
                name_en VARCHAR(120),
                code VARCHAR(40) NOT NULL UNIQUE,
                department_id INTEGER,
                description TEXT,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    for table, columns in table_columns.items():
        existing = {row[1] for row in db.execute(text(f"PRAGMA table_info({table})")).all()}
        for column, definition in columns.items():
            if column not in existing:
                db.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {definition}"))
    db.commit()


def ensure_runtime_columns(db: Session) -> None:
    inspector = inspect(db.bind)
    table_names = set(inspector.get_table_names())
    dialect = db.bind.dialect.name if db.bind else "sqlite"
    bool_true = "1" if dialect == "sqlite" else "true"
    bool_false = "0" if dialect == "sqlite" else "false"
    timestamp_type = "DATETIME" if dialect == "sqlite" else "TIMESTAMP WITH TIME ZONE"
    if "settings_general" in table_names:
        general_columns = {column["name"] for column in inspector.get_columns("settings_general")}
        if "login_intro_text" not in general_columns:
            db.execute(text("ALTER TABLE settings_general ADD COLUMN login_intro_text TEXT"))
        db.execute(
            text(
                """
                UPDATE settings_general
                SET login_intro_text = :default_text
                WHERE login_intro_text IS NULL OR login_intro_text = ''
                """
            ),
            {"default_text": "منصة داخلية موحدة لاستقبال الطلبات، تتبع مراحل الاعتماد، مراقبة مؤشرات الخدمة، وتوثيق الأثر التشغيلي."},
        )
        db.commit()
    if "security_policies" in table_names:
        security_columns = {column["name"] for column in inspector.get_columns("security_policies")}
        if "login_identifier_mode" not in security_columns:
            db.execute(text("ALTER TABLE security_policies ADD COLUMN login_identifier_mode VARCHAR(30) DEFAULT 'email_or_employee_id'"))
            db.commit()
        if "temporary_password" not in security_columns:
            db.execute(text("ALTER TABLE security_policies ADD COLUMN temporary_password VARCHAR(128) DEFAULT 'Change@12345'"))
            db.execute(text("UPDATE security_policies SET temporary_password = 'Change@12345' WHERE temporary_password IS NULL OR temporary_password = ''"))
            db.commit()
    if "system_health_checks" in table_names:
        health_check_columns = {column["name"] for column in inspector.get_columns("system_health_checks")}
        if "category" not in health_check_columns:
            db.execute(text("ALTER TABLE system_health_checks ADD COLUMN category VARCHAR(80)"))
            db.execute(text("UPDATE system_health_checks SET category = COALESCE(category, check_name)"))
            db.commit()
    if "users" in table_names:
        user_columns = {column["name"] for column in inspector.get_columns("users")}
        user_column_defs = {
            "job_title": "VARCHAR(120)",
            "role_id": "INTEGER",
            "specialized_section_id": "INTEGER",
            "relationship_type": "VARCHAR(40) DEFAULT 'employee'",
            "password_expires_at": timestamp_type,
            "is_locked": f"BOOLEAN DEFAULT {bool_false}",
            "force_password_change": f"BOOLEAN DEFAULT {bool_false}",
            "allowed_login_from_ip": "VARCHAR(255)",
            "notes": "TEXT",
            "last_login_at": timestamp_type,
            "updated_at": timestamp_type,
        }
        for column, definition in user_column_defs.items():
            if column not in user_columns:
                db.execute(text(f"ALTER TABLE users ADD COLUMN {column} {definition}"))
        db.execute(text("UPDATE users SET relationship_type = COALESCE(NULLIF(relationship_type, ''), CASE WHEN role = 'direct_manager' THEN 'direct_manager' ELSE 'employee' END)"))
        db.execute(text("UPDATE users SET role = 'administration_manager' WHERE role IN ('it_manager', 'department_manager')"))
        db.commit()
    if "specialized_sections" in table_names:
        section_columns = {column["name"] for column in inspector.get_columns("specialized_sections")}
        if "department_id" not in section_columns:
            db.execute(text("ALTER TABLE specialized_sections ADD COLUMN department_id INTEGER"))
            db.commit()
    if "roles" in table_names:
        role_columns = {column["name"] for column in inspector.get_columns("roles")}
        role_column_defs = {
            "name_ar": "VARCHAR(120)",
            "name_en": "VARCHAR(120)",
            "code": "VARCHAR(80)",
            "description": "TEXT",
            "is_system_role": f"BOOLEAN DEFAULT {bool_true}",
            "updated_at": timestamp_type,
        }
        for column, definition in role_column_defs.items():
            if column not in role_columns:
                db.execute(text(f"ALTER TABLE roles ADD COLUMN {column} {definition}"))
        db.execute(text("UPDATE roles SET code = COALESCE(NULLIF(code, ''), name), name_ar = COALESCE(NULLIF(name_ar, ''), label_ar), name_en = COALESCE(NULLIF(name_en, ''), name), is_system_role = COALESCE(is_system_role, :true_value)"), {"true_value": True})
        legacy_role = (
            db.scalar(select(Role).where(Role.code == "it_manager"))
            or db.scalar(select(Role).where(Role.name == "it_manager"))
            or db.scalar(select(Role).where(Role.code == "department_manager"))
            or db.scalar(select(Role).where(Role.name == "department_manager"))
        )
        department_manager_role = db.scalar(select(Role).where(Role.code == "administration_manager")) or db.scalar(select(Role).where(Role.name == "administration_manager"))
        if legacy_role and not department_manager_role:
            legacy_role.name = "administration_manager"
            legacy_role.code = "administration_manager"
            legacy_role.label_ar = "مدير إدارة"
            legacy_role.name_ar = "مدير إدارة"
            legacy_role.name_en = "Department Manager"
            legacy_role.is_system_role = True
            legacy_role.is_active = True
        elif legacy_role and department_manager_role and legacy_role.id != department_manager_role.id:
            db.execute(text("UPDATE users SET role_id = :new_id WHERE role_id = :old_id"), {"new_id": department_manager_role.id, "old_id": legacy_role.id})
            legacy_role.name = f"it_manager_legacy_{legacy_role.id}"
            legacy_role.code = f"it_manager_legacy_{legacy_role.id}"
            legacy_role.label_ar = "مدير إدارة (قديم)"
            legacy_role.name_ar = "مدير إدارة (قديم)"
            legacy_role.name_en = "Legacy IT Manager"
            legacy_role.is_system_role = False
            legacy_role.is_active = False
        db.commit()
    legacy_role_columns = [
        ("workflow_approval_configs", "approver_role"),
        ("workflow_steps", "approver_role"),
        ("approval_steps", "role"),
    ]
    for table_name, column_name in legacy_role_columns:
        if table_name in table_names:
            columns = {column["name"] for column in inspector.get_columns(table_name)}
            if column_name in columns:
                db.execute(text(f"UPDATE {table_name} SET {column_name} = 'administration_manager' WHERE {column_name} = 'it_manager'"))
    db.commit()
    workflow_columns = {column["name"] for column in inspector.get_columns("workflow_template_steps")}
    if "return_to_step_order" not in workflow_columns:
        db.execute(text("ALTER TABLE workflow_template_steps ADD COLUMN return_to_step_order INTEGER"))
        db.commit()
    if "target_department_id" not in workflow_columns:
        db.execute(text("ALTER TABLE workflow_template_steps ADD COLUMN target_department_id INTEGER"))
        db.commit()
    if "internal_messages" in table_names:
        message_columns = {column["name"] for column in inspector.get_columns("internal_messages")}
        if "thread_id" not in message_columns:
            db.execute(text("ALTER TABLE internal_messages ADD COLUMN thread_id INTEGER"))
            db.commit()
        if "message_type" not in message_columns:
            db.execute(text("ALTER TABLE internal_messages ADD COLUMN message_type VARCHAR(40) DEFAULT 'internal_correspondence'"))
            db.execute(text("UPDATE internal_messages SET message_type = 'internal_correspondence' WHERE message_type IS NULL OR message_type = ''"))
            db.commit()
        if "priority" not in message_columns:
            db.execute(text("ALTER TABLE internal_messages ADD COLUMN priority VARCHAR(20) DEFAULT 'normal'"))
            db.execute(text("UPDATE internal_messages SET priority = 'normal' WHERE priority IS NULL OR priority = ''"))
            db.commit()
        if "classification_code" not in message_columns:
            db.execute(text("ALTER TABLE internal_messages ADD COLUMN classification_code VARCHAR(80) DEFAULT 'internal'"))
            db.execute(text("UPDATE internal_messages SET classification_code = 'internal' WHERE classification_code IS NULL OR classification_code = ''"))
            db.commit()
        if "is_sender_archived" not in message_columns:
            default_value = "0" if db.bind and db.bind.dialect.name == "sqlite" else "false"
            db.execute(text(f"ALTER TABLE internal_messages ADD COLUMN is_sender_archived BOOLEAN DEFAULT {default_value}"))
            db.commit()
        if "is_sender_deleted" not in message_columns:
            default_value = "0" if db.bind and db.bind.dialect.name == "sqlite" else "false"
            db.execute(text(f"ALTER TABLE internal_messages ADD COLUMN is_sender_deleted BOOLEAN DEFAULT {default_value}"))
            db.commit()
        if "is_draft" not in message_columns:
            default_value = "0" if db.bind and db.bind.dialect.name == "sqlite" else "false"
            db.execute(text(f"ALTER TABLE internal_messages ADD COLUMN is_draft BOOLEAN DEFAULT {default_value}"))
            db.commit()
        if "updated_at" not in message_columns:
            column_type = "DATETIME" if db.bind and db.bind.dialect.name == "sqlite" else "TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP"
            db.execute(text(f"ALTER TABLE internal_messages ADD COLUMN updated_at {column_type}"))
            db.execute(text("UPDATE internal_messages SET updated_at = created_at WHERE updated_at IS NULL"))
            db.commit()
        if "message_uid" not in message_columns:
            db.execute(text("ALTER TABLE internal_messages ADD COLUMN message_uid VARCHAR(40)"))
            db.commit()
        ensure_message_tracking_ids(db)
        db.execute(text('CREATE UNIQUE INDEX IF NOT EXISTS "idx_internal_messages_message_uid" ON "internal_messages" (message_uid)'))
        db.execute(text('CREATE INDEX IF NOT EXISTS "idx_internal_messages_priority_created" ON "internal_messages" (priority, created_at)'))
        db.execute(text('CREATE INDEX IF NOT EXISTS "idx_internal_messages_classification_created" ON "internal_messages" (classification_code, created_at)'))
        db.commit()
    if "internal_message_recipients" in table_names:
        recipient_columns = {column["name"] for column in inspector.get_columns("internal_message_recipients")}
        if "is_deleted" not in recipient_columns:
            default_value = "0" if db.bind and db.bind.dialect.name == "sqlite" else "false"
            db.execute(text(f"ALTER TABLE internal_message_recipients ADD COLUMN is_deleted BOOLEAN DEFAULT {default_value}"))
            db.commit()
    if "ai_settings" in table_names:
        ai_columns = {column["name"] for column in inspector.get_columns("ai_settings")}
        ai_column_defs = {
            "mode": "VARCHAR(30) DEFAULT 'disabled'",
            "assistant_name": "VARCHAR(160) DEFAULT 'المساعد الذكي للمراسلات'",
            "assistant_description": "TEXT",
            "system_prompt": "TEXT",
            "default_language": "VARCHAR(20) DEFAULT 'ar'",
            "timeout_seconds": "INTEGER DEFAULT 60",
            "show_human_review_disclaimer": f"BOOLEAN DEFAULT {bool_true}",
            "allow_message_improvement": f"BOOLEAN DEFAULT {bool_true}",
            "allow_missing_info_detection": f"BOOLEAN DEFAULT {bool_true}",
            "allow_translate_ar_en": f"BOOLEAN DEFAULT {bool_false}",
            "mask_emails": f"BOOLEAN DEFAULT {bool_true}",
            "mask_phone_numbers": f"BOOLEAN DEFAULT {bool_true}",
            "mask_employee_ids": f"BOOLEAN DEFAULT {bool_true}",
            "mask_usernames": f"BOOLEAN DEFAULT {bool_false}",
            "mask_request_numbers": f"BOOLEAN DEFAULT {bool_false}",
            "allow_request_context": f"BOOLEAN DEFAULT {bool_true}",
            "request_context_level": "VARCHAR(40) DEFAULT 'basic_only'",
            "allow_attachments_to_ai": f"BOOLEAN DEFAULT {bool_false}",
            "store_full_prompt_logs": f"BOOLEAN DEFAULT {bool_false}",
            "show_in_compose_message": f"BOOLEAN DEFAULT {bool_true}",
            "show_in_message_details": f"BOOLEAN DEFAULT {bool_true}",
            "show_in_request_messages_tab": f"BOOLEAN DEFAULT {bool_true}",
        }
        for column, definition in ai_column_defs.items():
            if column not in ai_columns:
                db.execute(text(f"ALTER TABLE ai_settings ADD COLUMN {column} {definition}"))
        db.execute(
            text(
                """
                UPDATE ai_settings
                SET
                    provider = COALESCE(NULLIF(provider, ''), 'local_ollama'),
                    api_base_url = CASE WHEN COALESCE(NULLIF(api_base_url, ''), '') = '' AND COALESCE(NULLIF(provider, ''), 'local_ollama') IN ('local_ollama', 'ollama', 'ollama_native') THEN 'http://localhost:11434' ELSE api_base_url END,
                    model_name = COALESCE(NULLIF(model_name, ''), 'qwen3:8b'),
                    mode = CASE WHEN is_enabled THEN COALESCE(NULLIF(mode, ''), 'enabled') ELSE COALESCE(NULLIF(mode, ''), 'disabled') END,
                    assistant_name = COALESCE(NULLIF(assistant_name, ''), 'المساعد الذكي للمراسلات'),
                    default_language = COALESCE(NULLIF(default_language, ''), 'ar'),
                    timeout_seconds = COALESCE(timeout_seconds, 60),
                    request_context_level = COALESCE(NULLIF(request_context_level, ''), 'basic_only'),
                    system_prompt = COALESCE(NULLIF(system_prompt, ''), :default_system_prompt)
                """
            ),
            {"default_system_prompt": DEFAULT_AI_SYSTEM_PROMPT},
        )
        db.commit()
    if "ai_usage_logs" in table_names:
        usage_columns = {column["name"] for column in inspector.get_columns("ai_usage_logs")}
        if "feature_code" not in usage_columns:
            db.execute(text("ALTER TABLE ai_usage_logs ADD COLUMN feature_code VARCHAR(80)"))
            db.execute(text("UPDATE ai_usage_logs SET feature_code = feature WHERE feature_code IS NULL OR feature_code = ''"))
        if "latency_ms" not in usage_columns:
            db.execute(text("ALTER TABLE ai_usage_logs ADD COLUMN latency_ms INTEGER DEFAULT 0"))
        if "prompt_text" not in usage_columns:
            db.execute(text("ALTER TABLE ai_usage_logs ADD COLUMN prompt_text TEXT"))
        if "output_text" not in usage_columns:
            db.execute(text("ALTER TABLE ai_usage_logs ADD COLUMN output_text TEXT"))
        db.commit()
    if "ai_prompt_templates" in table_names:
        prompt_columns = {column["name"] for column in inspector.get_columns("ai_prompt_templates")}
        if "description" not in prompt_columns:
            db.execute(text("ALTER TABLE ai_prompt_templates ADD COLUMN description TEXT"))
        if "version_number" not in prompt_columns:
            db.execute(text("ALTER TABLE ai_prompt_templates ADD COLUMN version_number INTEGER DEFAULT 1"))
        if "created_by" not in prompt_columns:
            db.execute(text("ALTER TABLE ai_prompt_templates ADD COLUMN created_by INTEGER"))
        db.commit()
    if "message_request_integration_settings" in table_names:
        request_message_columns = {column["name"] for column in inspector.get_columns("message_request_integration_settings")}
        request_message_column_defs = {
            "show_request_notification_checkbox": f"BOOLEAN DEFAULT {bool_true}",
            "default_send_request_notification": f"BOOLEAN DEFAULT {bool_true}",
            "allow_requester_toggle_notification": f"BOOLEAN DEFAULT {bool_true}",
        }
        for column, definition in request_message_column_defs.items():
            if column not in request_message_columns:
                db.execute(text(f"ALTER TABLE message_request_integration_settings ADD COLUMN {column} {definition}"))
        db.commit()
    if "system_versions" in table_names:
        version_columns = {column["name"] for column in inspector.get_columns("system_versions")}
        version_column_defs = {
            "build_number": "VARCHAR(80)",
            "commit_hash": "VARCHAR(80)",
            "deployed_by": "INTEGER",
            "status": "VARCHAR(30) DEFAULT 'installed'",
        }
        for column, definition in version_column_defs.items():
            if column not in version_columns:
                db.execute(text(f"ALTER TABLE system_versions ADD COLUMN {column} {definition}"))
        db.commit()
    if "request_types" in table_names:
        request_type_columns = {column["name"] for column in inspector.get_columns("request_types")}
        request_type_defs = {
            "current_version_number": "INTEGER DEFAULT 1",
            "auto_assign_strategy": "VARCHAR(40) DEFAULT 'none'",
            "max_attachments": "INTEGER DEFAULT 1",
            "max_file_size_mb": "INTEGER DEFAULT 10",
            "allowed_extensions_json": "JSON DEFAULT '[\"pdf\", \"png\", \"jpg\", \"jpeg\"]'",
        }
        for column, definition in request_type_defs.items():
            if column not in request_type_columns:
                db.execute(text(f"ALTER TABLE request_types ADD COLUMN {column} {definition}"))
        db.execute(text("UPDATE request_types SET current_version_number = COALESCE(current_version_number, 1)"))
        db.execute(text("UPDATE request_types SET auto_assign_strategy = COALESCE(NULLIF(auto_assign_strategy, ''), 'none')"))
        db.execute(text("UPDATE request_types SET max_attachments = COALESCE(max_attachments, CASE WHEN allow_multiple_attachments THEN 5 ELSE 1 END)"))
        db.execute(text("UPDATE request_types SET max_file_size_mb = COALESCE(max_file_size_mb, 10)"))
        db.commit()
    if "service_requests" in table_names:
        request_columns = {column["name"] for column in inspector.get_columns("service_requests")}
        service_request_defs = {
            "request_type_version_id": "INTEGER",
            "request_type_version_number": "INTEGER DEFAULT 1",
            "assigned_to_id": "INTEGER",
            "request_type_snapshot": "JSON DEFAULT '{}'" if dialect != "sqlite" else "JSON DEFAULT '{}'",
            "form_schema_snapshot": "JSON DEFAULT '[]'" if dialect != "sqlite" else "JSON DEFAULT '[]'",
        }
        for column, definition in service_request_defs.items():
            if column not in request_columns:
                db.execute(text(f"ALTER TABLE service_requests ADD COLUMN {column} {definition}"))
        db.execute(text("UPDATE service_requests SET request_type_version_number = COALESCE(request_type_version_number, 1)"))
        db.commit()


def request_type_version_snapshot(db: Session, request_type: RequestTypeSetting) -> dict:
    fields = db.scalars(
        select(RequestTypeField)
        .where(RequestTypeField.request_type_id == request_type.id, RequestTypeField.is_active == True)
        .order_by(RequestTypeField.sort_order)
    ).all()
    template = db.scalar(select(WorkflowTemplate).where(WorkflowTemplate.request_type_id == request_type.id, WorkflowTemplate.is_active == True))
    steps = []
    if template:
        steps = db.scalars(
            select(WorkflowTemplateStep)
            .where(WorkflowTemplateStep.workflow_template_id == template.id, WorkflowTemplateStep.is_active == True)
            .order_by(WorkflowTemplateStep.sort_order)
        ).all()
    return {
        "request_type": {
            "id": request_type.id,
            "code": request_type.code,
            "name_ar": request_type.name_ar,
            "name_en": request_type.name_en,
            "category": request_type.category,
            "assigned_section": request_type.assigned_section,
            "assigned_department_id": request_type.assigned_department_id,
            "auto_assign_strategy": request_type.auto_assign_strategy or "none",
            "description": request_type.description,
            "icon": request_type.icon,
            "is_active": request_type.is_active,
            "requires_attachment": request_type.requires_attachment,
            "allow_multiple_attachments": request_type.allow_multiple_attachments,
            "max_attachments": request_type.max_attachments or (5 if request_type.allow_multiple_attachments else 1),
            "max_file_size_mb": request_type.max_file_size_mb or 10,
            "allowed_extensions_json": request_type.allowed_extensions_json or ["pdf", "png", "jpg", "jpeg"],
            "default_priority": request_type.default_priority,
            "sla_response_hours": request_type.sla_response_hours,
            "sla_resolution_hours": request_type.sla_resolution_hours,
            "version_number": request_type.current_version_number or 1,
        },
        "fields": [
            {
                "field_name": field.field_name,
                "label_ar": field.label_ar,
                "label_en": field.label_en,
                "field_type": field.field_type,
                "is_required": field.is_required,
                "placeholder": field.placeholder,
                "help_text": field.help_text,
                "validation_rules": field.validation_rules or {},
                "options": field.options or [],
                "sort_order": field.sort_order,
                "is_active": field.is_active,
            }
            for field in fields
        ],
        "workflow": [
            {
                "step_name_ar": step.step_name_ar,
                "step_name_en": step.step_name_en,
                "step_type": step.step_type,
                "approver_role_id": step.approver_role_id,
                "approver_user_id": step.approver_user_id,
                "is_mandatory": step.is_mandatory,
                "can_reject": step.can_reject,
                "can_return_for_edit": step.can_return_for_edit,
                "return_to_step_order": step.return_to_step_order,
                "sla_hours": step.sla_hours,
                "escalation_user_id": step.escalation_user_id,
                "sort_order": step.sort_order,
                "is_active": step.is_active,
            }
            for step in steps
        ],
    }


def seed_request_type_versions(db: Session) -> None:
    for request_type in db.scalars(select(RequestTypeSetting)).all():
        active = db.scalar(
            select(RequestTypeVersion).where(
                RequestTypeVersion.request_type_id == request_type.id,
                RequestTypeVersion.status == "active",
            )
        )
        if active:
            continue
        version_number = request_type.current_version_number or 1
        db.add(
            RequestTypeVersion(
                request_type_id=request_type.id,
                version_number=version_number,
                status="active",
                change_summary="Initial published version",
                snapshot_json=request_type_version_snapshot(db, request_type),
                activated_at=datetime.utcnow(),
            )
        )
    db.commit()


def seed_request_types(db: Session) -> None:
    existing_count = db.scalar(select(func.count()).select_from(RequestTypeSetting)) or 0
    if existing_count:
        return
    it_department = db.scalar(select(Department).where(Department.name_en == "Information Technology"))
    for name_ar, name_en, code, category, description, response_hours, resolution_hours, fields, steps in DEFAULT_REQUEST_TYPES:
        item = db.scalar(select(RequestTypeSetting).where(RequestTypeSetting.code == code))
        if not item:
            item = RequestTypeSetting(
                request_type=code,
                label_ar=name_ar,
                name_ar=name_ar,
                name_en=name_en,
                code=code,
                category=category,
                assigned_department_id=it_department.id if it_department else None,
                auto_assign_strategy="least_open_requests",
                description=description,
                icon="file-text",
                is_enabled=True,
                is_active=True,
                require_attachment=False,
                requires_attachment=False,
                allow_multiple_attachments=True,
                max_attachments=5,
                max_file_size_mb=10,
                allowed_extensions_json=["pdf", "png", "jpg", "jpeg"],
                default_priority="medium",
                sla_response_hours=response_hours,
                sla_resolution_hours=resolution_hours,
            )
            db.add(item)
            db.flush()
        for index, field_name in enumerate(fields, start=1):
            exists = db.scalar(select(RequestTypeField).where(RequestTypeField.request_type_id == item.id, RequestTypeField.field_name == field_name))
            if not exists:
                db.add(
                    RequestTypeField(
                        request_type_id=item.id,
                        label_ar=field_name,
                        label_en=field_name.replace("_", " ").title(),
                        field_name=field_name,
                        field_type="textarea" if field_name in {"reason", "issue_description"} else "text",
                        is_required=True,
                        sort_order=index,
                    )
                )
        template = db.scalar(select(WorkflowTemplate).where(WorkflowTemplate.request_type_id == item.id))
        if not template:
            template = WorkflowTemplate(request_type_id=item.id, request_type=code, name=f"{name_en} Workflow", is_active=True)
            db.add(template)
            db.flush()
        for index, step_name in enumerate(steps, start=1):
            exists = db.scalar(select(WorkflowTemplateStep).where(WorkflowTemplateStep.workflow_template_id == template.id, WorkflowTemplateStep.sort_order == index))
            if not exists:
                db.add(
                    WorkflowTemplateStep(
                        workflow_template_id=template.id,
                        step_name_ar=step_name,
                        step_name_en=step_name,
                        step_type=step_name.lower().replace(" ", "_"),
                        is_mandatory=True,
                        can_reject=True,
                        can_return_for_edit=True,
                        sla_hours=8,
                        sort_order=index,
                        is_active=True,
                    )
                )
    db.commit()


def seed_database(db: Session) -> None:
    ensure_sqlite_dev_columns(db)
    ensure_runtime_columns(db)
    for code, name_ar, name_en, description in DEFAULT_SPECIALIZED_SECTIONS:
        exists = db.scalar(select(SpecializedSection).where(SpecializedSection.code == code))
        if not exists:
            db.add(SpecializedSection(code=code, name_ar=name_ar, name_en=name_en, description=description, is_active=True))
    db.flush()

    for name_ar, name_en, code in DEFAULT_DEPARTMENTS:
        exists = db.scalar(select(Department).where(Department.name_en == name_en))
        if not exists:
            db.add(Department(name_ar=name_ar, name_en=name_en, code=code, is_active=True))
    db.flush()

    for name, label_ar in DEFAULT_ROLES:
        role = db.scalar(select(Role).where(Role.name == name))
        if not role:
            db.add(Role(name=name, label_ar=label_ar, name_ar=label_ar, name_en=name.replace("_", " ").title(), code=name, is_system_role=True, is_active=True))
        else:
            role.label_ar = label_ar
            role.name_ar = label_ar if role.is_system_role or role.name == name or role.code == name else role.name_ar or label_ar
            role.name_en = role.name_en or name.replace("_", " ").title()
            role.code = role.code or name
            role.is_system_role = True
    db.flush()

    admin = db.scalar(select(User).where(User.email == settings.seed_admin_email))
    it_department = db.scalar(select(Department).where(Department.name_en == "Information Technology"))
    if not admin:
        db.add(
            User(
                employee_id="ADM-0001",
                username="admin",
                full_name_ar="مدير النظام",
                full_name_en="System Administrator",
                email=str(settings.seed_admin_email),
                hashed_password=get_password_hash(settings.seed_admin_password),
                role=UserRole.SUPER_ADMIN,
                department_id=it_department.id if it_department else None,
            )
        )
    seed_request_types(db)
    seed_request_type_versions(db)
    from app.services.messaging_settings_service import seed_messaging_settings, sync_legacy_message_settings

    seed_messaging_settings(db)
    sync_legacy_message_settings(db)
    db.commit()
