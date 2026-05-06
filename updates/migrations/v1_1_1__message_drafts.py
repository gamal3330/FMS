from sqlalchemy import text


def _column_names(connection, table_name):
    dialect = connection.dialect.name
    if dialect == "sqlite":
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
    dialect = connection.dialect.name
    bool_default = "0" if dialect == "sqlite" else "false"
    timestamp_type = "DATETIME" if dialect == "sqlite" else "TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP"

    if "is_draft" not in columns:
        connection.execute(text(f"ALTER TABLE internal_messages ADD COLUMN is_draft BOOLEAN DEFAULT {bool_default}"))
    if "updated_at" not in columns:
        connection.execute(text(f"ALTER TABLE internal_messages ADD COLUMN updated_at {timestamp_type}"))
        connection.execute(text("UPDATE internal_messages SET updated_at = created_at WHERE updated_at IS NULL"))

    indexes = [
        ("idx_internal_messages_sender_draft_updated", "internal_messages", "sender_id, is_draft, updated_at"),
        ("idx_internal_messages_draft_created", "internal_messages", "is_draft, created_at"),
    ]
    for name, table, columns_expr in indexes:
        connection.execute(text(f'CREATE INDEX IF NOT EXISTS "{name}" ON "{table}" ({columns_expr})'))
