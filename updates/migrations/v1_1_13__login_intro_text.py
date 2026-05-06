from sqlalchemy import text


DEFAULT_LOGIN_INTRO_TEXT = "منصة داخلية موحدة لاستقبال الطلبات، تتبع مراحل الاعتماد، مراقبة مؤشرات الخدمة، وتوثيق الأثر التشغيلي."


def _column_names(connection, table_name):
    if connection.dialect.name == "sqlite":
        return {row[1] for row in connection.execute(text(f"PRAGMA table_info({table_name})")).all()}
    rows = connection.execute(
        text(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = :table_name
            """
        ),
        {"table_name": table_name},
    ).all()
    return {row[0] for row in rows}


def upgrade(connection):
    columns = _column_names(connection, "settings_general")
    if "login_intro_text" not in columns:
        connection.execute(text("ALTER TABLE settings_general ADD COLUMN login_intro_text TEXT"))
    connection.execute(
        text(
            """
            UPDATE settings_general
            SET login_intro_text = :default_text
            WHERE login_intro_text IS NULL OR login_intro_text = ''
            """
        ),
        {"default_text": DEFAULT_LOGIN_INTRO_TEXT},
    )
