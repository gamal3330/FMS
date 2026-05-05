from functools import lru_cache
from pydantic import EmailStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "QIB IT Service Portal"
    environment: str = "development"
    api_v1_prefix: str = "/api/v1"
    database_url: str = "postgresql+psycopg://qib:qib@postgres:5432/qib_it_portal"
    secret_key: str = "change-me-before-production"
    access_token_expire_minutes: int = 60
    upload_dir: str = "uploads"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    request_slow_ms: int = 1000
    db_pool_size: int = 10
    db_max_overflow: int = 20
    db_pool_recycle_seconds: int = 1800
    system_version_file: str = "../version.txt"
    update_manifest_file: str = "../update-manifest.json"
    updates_dir: str = "../updates"
    seed_admin_email: EmailStr = "admin@qib.internal-bank.qa"
    seed_admin_password: str = "Admin@12345"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
