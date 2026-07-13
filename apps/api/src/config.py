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

    # Server-side floor on the edge-reported face quality score; detections
    # below it are dropped before matching (tune alongside the edge QUALITY_FLOOR).
    QUALITY_FLOOR: float = 0.2

    # WhatsApp Cloud API (Meta). Leave unset in dev to skip WA sends.
    WA_PHONE_NUMBER_ID: str | None = None   # WhatsApp Business phone-number ID
    WA_TOKEN: str | None = None              # Meta System User access token
    WA_WEBHOOK_VERIFY_TOKEN: str | None = None  # random string used in hub.verify
    WA_APP_SECRET: str | None = None         # Meta App Secret — signs X-Hub-Signature-256

    # §19-E kiosk consent seam: how long a kiosk enrollment stays claimable by
    # the entrance camera as a pending consent token.
    ENROLLMENT_PENDING_WINDOW_SECONDS: int = 120

    # Per-customer salesperson-alert throttle: once a REPEAT alert fires for a
    # customer, further REPEAT detections within this window do NOT re-alert or
    # re-draft (one alert per walk-in session, not per camera frame).
    ALERT_COOLDOWN_MINUTES: int = 30

    # Cadence engine (followups table + Celery beat).
    WELCOME_FOLLOWUP_DELAY_MINUTES: int = 120   # kiosk enrollment → welcome message
    FOLLOWUP_BATCH_SIZE: int = 25               # max sends per beat tick
    FOLLOWUP_STALE_DAYS: int = 3                # pending past due → cancelled

    # Dashboard URL — embedded in salesperson alert links.
    DASHBOARD_URL: str = "https://topaz.dmcdigital.in"

    # Pre-shared key for dashboard server actions → /api/whatsapp/send.
    DASHBOARD_API_KEY: str | None = None

    # Anthropic API key for AI draft generation. If unset, falls back to template.
    ANTHROPIC_API_KEY: str | None = None

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
