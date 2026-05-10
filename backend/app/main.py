from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
import time

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.performance import RequestTimingMiddleware
from app.db.init_db import seed_database
from app.db.session import Base, SessionLocal, engine
from app import models  # noqa: F401
from app.services.database_backup_scheduler import start_backup_scheduler
from app.services.update_manager import ensure_current_version, read_current_version_file

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="Internal service request management platform for bank employees.",
    openapi_url=f"{settings.api_v1_prefix}/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RequestTimingMiddleware)

app.include_router(api_router, prefix=settings.api_v1_prefix)
app.include_router(api_router, prefix="/api")


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_database(db)
        ensure_current_version(db)
        db.commit()
    finally:
        db.close()
    start_backup_scheduler()


@app.get("/", tags=["Health"])
def root() -> dict[str, object]:
    return {
        "status": "running",
        "service": settings.app_name,
        "health": "/health",
        "api": settings.api_v1_prefix,
        "docs": "/docs",
    }


@app.get("/health", tags=["Health"])
def health() -> dict[str, object]:
    started = time.perf_counter()
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1")).scalar_one()
        database = "ok"
    except Exception:
        database = "error"
    finally:
        db.close()
    return {
        "status": "ok" if database == "ok" else "degraded",
        "service": settings.app_name,
        "version": read_current_version_file(),
        "database": database,
        "response_ms": int((time.perf_counter() - started) * 1000),
    }
