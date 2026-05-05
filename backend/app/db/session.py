from collections.abc import Generator
import json

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import get_settings

settings = get_settings()
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
pool_options = (
    {}
    if settings.database_url.startswith("sqlite")
    else {
        "pool_size": settings.db_pool_size,
        "max_overflow": settings.db_max_overflow,
        "pool_recycle": settings.db_pool_recycle_seconds,
    }
)
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    connect_args=connect_args,
    **pool_options,
    json_serializer=lambda value: json.dumps(value, ensure_ascii=False),
    json_deserializer=json.loads,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
