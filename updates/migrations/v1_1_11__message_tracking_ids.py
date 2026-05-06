from datetime import datetime

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


def _message_year(created_at):
    if isinstance(created_at, datetime):
        return created_at.year
    value = str(created_at or "").strip()
    if len(value) >= 4 and value[:4].isdigit():
        return int(value[:4])
    return datetime.utcnow().year


def upgrade(connection):
    columns = _column_names(connection, "internal_messages")
    if "message_uid" not in columns:
        connection.execute(text("ALTER TABLE internal_messages ADD COLUMN message_uid VARCHAR(40)"))

    used = {
        row[0]
        for row in connection.execute(
            text("SELECT message_uid FROM internal_messages WHERE message_uid IS NOT NULL AND message_uid <> ''")
        ).all()
        if row[0]
    }
    counters = {}
    rows = connection.execute(
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
        year = _message_year(created_at)
        counters[year] = counters.get(year, 0) + 1
        message_uid = f"MSG-{year}-{counters[year]:06d}"
        while message_uid in used:
            counters[year] += 1
            message_uid = f"MSG-{year}-{counters[year]:06d}"
        used.add(message_uid)
        connection.execute(
            text("UPDATE internal_messages SET message_uid = :message_uid WHERE id = :message_id"),
            {"message_uid": message_uid, "message_id": message_id},
        )

    connection.execute(text('CREATE UNIQUE INDEX IF NOT EXISTS "idx_internal_messages_message_uid" ON "internal_messages" (message_uid)'))
