from sqlalchemy import func, inspect, select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import get_password_hash
from app.models.enums import UserRole
from app.models.settings import RequestTypeField, RequestTypeSetting, SpecializedSection, WorkflowTemplate, WorkflowTemplateStep
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
    ("it_staff", "فريق تقنية المعلومات"),
    ("it_manager", "مدير تقنية المعلومات"),
    ("information_security", "أمن المعلومات"),
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
    ("طلب إيميل", "Email Request", "EMAIL", "accounts", "إدارة طلبات البريد الإلكتروني", 4, 8, ["target_user", "email_action", "reason"], ["Direct Manager", "IT Manager", "Implementation Engineer"]),
    ("طلب دومين", "Domain Request", "DOMAIN", "accounts", "إدارة مستخدمي الدومين", 4, 8, ["target_user", "domain_action", "reason"], ["Direct Manager", "IT Manager", "Implementation Engineer"]),
    ("طلب VPN", "VPN Request", "VPN", "access", "طلب وصول آمن عن بعد", 8, 24, ["employee_name", "employee_id", "department", "access_needed", "reason", "start_date", "end_date"], ["Direct Manager", "Information Security", "IT Manager", "Implementation Engineer"]),
    ("طلب وصول إنترنت", "Internet Access", "INTERNET", "access", "طلب صلاحيات تصفح الإنترنت", 8, 24, ["target_user", "access_level", "reason"], ["Direct Manager", "Information Security", "IT Manager"]),
    ("طلب نسخ بيانات", "Data Copy", "DATA_COPY", "security", "طلب نسخ بيانات إلى وسيط خارجي أو بريد", 8, 48, ["copy_method", "source_location", "destination", "reason"], ["Direct Manager", "Information Security", "IT Manager", "Executive Management", "Implementation Engineer"]),
    ("طلب وصول عبر شبكة البنك", "Network Access", "NETWORK", "network", "فتح اتصال شبكي بين مصدر ووجهة", 8, 48, ["source_ip", "destination_ip", "destination_port", "nat_port", "reason"], ["Direct Manager", "Information Security", "IT Manager", "Implementation Engineer"]),
    ("طلب تركيب / نقل جهاز كمبيوتر", "Computer Install/Move", "COMPUTER_MOVE", "hardware", "نقل أو تركيب جهاز كمبيوتر", 4, 24, ["asset_tag", "current_location", "new_location", "reason"], ["Direct Manager", "IT Manager", "Implementation Engineer"]),
    ("طلب دعم فني", "Support Ticket", "SUPPORT", "support", "تذكرة دعم فني", 2, 8, ["affected_user", "category", "issue_description"], ["IT Staff", "Implementation Engineer"]),
]


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
            "administrative_section": "VARCHAR(40)",
            "failed_login_attempts": "INTEGER DEFAULT 0",
            "locked_until": "DATETIME",
            "password_changed_at": "DATETIME",
        },
        "settings_general": {
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
        },
        "request_types": {
            "name_ar": "VARCHAR(160)",
            "name_en": "VARCHAR(160)",
            "code": "VARCHAR(60)",
            "category": "VARCHAR(80)",
            "assigned_section": "VARCHAR(40)",
            "assigned_department_id": "INTEGER",
            "description": "TEXT",
            "icon": "VARCHAR(80)",
            "is_active": "BOOLEAN DEFAULT 1",
            "requires_attachment": "BOOLEAN DEFAULT 0",
            "allow_multiple_attachments": "BOOLEAN DEFAULT 0",
            "default_priority": "VARCHAR(20) DEFAULT 'medium'",
            "sla_response_hours": "INTEGER DEFAULT 4",
            "sla_resolution_hours": "INTEGER DEFAULT 24",
            "created_at": "DATETIME",
            "updated_at": "DATETIME",
        },
        "workflow_templates": {
            "request_type_id": "INTEGER",
            "created_at": "DATETIME",
            "updated_at": "DATETIME",
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
    workflow_columns = {column["name"] for column in inspector.get_columns("workflow_template_steps")}
    if "return_to_step_order" not in workflow_columns:
        db.execute(text("ALTER TABLE workflow_template_steps ADD COLUMN return_to_step_order INTEGER"))
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
                description=description,
                icon="file-text",
                is_enabled=True,
                is_active=True,
                require_attachment=False,
                requires_attachment=False,
                allow_multiple_attachments=True,
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
        if not db.scalar(select(Role).where(Role.name == name)):
            db.add(Role(name=name, label_ar=label_ar))
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
    db.commit()
