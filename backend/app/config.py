from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://abuya:abuya@localhost:5432/abuya_portal"
    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 480
    remember_token_days: int = 30
    login_max_attempts: int = 5
    login_lock_minutes: int = 15
    cors_origins: str = ""
    frontend_dir: str = ""
    auto_create_tables: bool = False
    session_idle_minutes: int = 30

    @field_validator("database_url")
    @classmethod
    def normalize_database_url(cls, v: str) -> str:
        v = v.strip()
        for prefix in ("postgres://", "postgresql://"):
            if v.startswith(prefix):
                return "postgresql+psycopg://" + v[len(prefix):]
        return v

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()