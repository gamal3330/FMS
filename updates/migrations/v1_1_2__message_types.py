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
    if "message_type" not in columns:
        connection.execute(text("ALTER TABLE internal_messages ADD COLUMN message_type VARCHAR(40) DEFAULT 'internal_correspondence'"))
    connection.execute(text("UPDATE internal_messages SET message_type = 'internal_correspondence' WHERE message_type IS NULL OR message_type = ''"))
    connection.execute(text('CREATE INDEX IF NOT EXISTS "idx_internal_messages_type_created" ON "internal_messages" (message_type, created_at)'))
    connection.execute(text('CREATE INDEX IF NOT EXISTS "idx_internal_messages_sender_type" ON "internal_messages" (sender_id, message_type)'))
