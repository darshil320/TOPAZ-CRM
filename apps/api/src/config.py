"""Runtime configuration via environment variables (pydantic-settings)."""

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Supabase Postgres — must use asyncpg scheme for SQLAlchemy async engine.
    DATABASE_URL: str
    REDIS_URL: str = "redis://localhost:6379/0"

    # Pre-shared key the edge worker sends in the API-Key header.
    EDGE_API_KEY: str

    # Recognition band thresholds (tune from real-camera data per §19-D).
    MATCH_THRESHOLD: float = 0.45
    NEW_THRESHOLD: float = 0.30

    # pgvector HNSW search-time ef parameter (higher = better recall, slower).
    HNSW_EF_SEARCH: int = 40

    @field_validator("DATABASE_URL")
    @classmethod
    def require_asyncpg_scheme(cls, v: str) -> str:
        if not v.startswith("postgresql+asyncpg://"):
            raise ValueError(
                "DATABASE_URL must use the asyncpg driver scheme: "
                "postgresql+asyncpg://user:pass@host/db"
            )
        return v

    @field_validator("REDIS_URL")
    @classmethod
    def require_redis_scheme(cls, v: str) -> str:
        if not v.startswith("redis://") and not v.startswith("rediss://"):
            raise ValueError("REDIS_URL must start with redis:// or rediss://")
        return v

    @field_validator("EDGE_API_KEY")
    @classmethod
    def require_min_length(cls, v: str) -> str:
        if len(v) < 16:
            raise ValueError("EDGE_API_KEY must be at least 16 characters")
        return v


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
