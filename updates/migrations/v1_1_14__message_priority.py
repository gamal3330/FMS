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
    columns = _column_names(connection, "internal_messages")
    if "priority" not in columns:
        connection.execute(text("ALTER TABLE internal_messages ADD COLUMN priority VARCHAR(20) DEFAULT 'normal'"))
    connection.execute(text("UPDATE internal_messages SET priority = 'normal' WHERE priority IS NULL OR priority = ''"))
    connection.execute(text('CREATE INDEX IF NOT EXISTS "idx_internal_messages_priority_created" ON "internal_messages" (priority, created_at)'))
