from sqlalchemy import text


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
    columns = _column_names(connection, "security_policies")
    if "temporary_password" not in columns:
        connection.execute(text("ALTER TABLE security_policies ADD COLUMN temporary_password VARCHAR(128) DEFAULT 'Change@12345'"))
    connection.execute(text("UPDATE security_policies SET temporary_password = 'Change@12345' WHERE temporary_password IS NULL OR temporary_password = ''"))
