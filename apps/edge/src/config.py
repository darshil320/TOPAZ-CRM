"""Runtime configuration for the Layer 2 edge worker.

All settings come from environment variables (or .env). Nothing is hardcoded at a
decision point — thresholds, URLs, and API keys are all overridable via env.
"""

from __future__ import annotations

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

CameraSource = int | str


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    api_url: str = Field(validation_alias="API_URL")
    api_key: SecretStr = Field(validation_alias="API_KEY")
    camera_source: CameraSource = Field(default=0, validation_alias="CAMERA_SOURCE")
    camera_id: str = Field(default="entrance-1", validation_alias="CAMERA_ID")
    cooldown_seconds: float = Field(default=30.0, gt=0.0, validation_alias="COOLDOWN_SECONDS")
    quality_floor: float = Field(default=0.4, ge=0.0, le=1.0, validation_alias="QUALITY_FLOOR")
    supabase_url: str | None = Field(default=None, validation_alias="SUPABASE_URL")
    supabase_service_role_key: SecretStr | None = Field(
        default=None,
        validation_alias="SUPABASE_SERVICE_ROLE_KEY",
    )
    request_timeout_seconds: float = Field(
        default=10.0,
        gt=0.0,
        validation_alias="REQUEST_TIMEOUT_SECONDS",
    )
    frame_poll_seconds: float = Field(
        default=0.01,
        gt=0.0,
        validation_alias="FRAME_POLL_SECONDS",
    )
    # §19-E consent seam: kiosk (poll API) | open (static test token) | off (drop all).
    consent_mode: str = Field(default="kiosk", validation_alias="CONSENT_MODE")
    consent_poll_seconds: float = Field(
        default=2.0,
        gt=0.0,
        validation_alias="CONSENT_POLL_SECONDS",
    )

    @field_validator("camera_source", mode="before")
    @classmethod
    def _parse_camera_source(cls, value: object) -> CameraSource:
        if value is None:
            return 0
        if isinstance(value, int):
            return value
        text = str(value).strip()
        if not text:
            return 0
        if text.isdecimal():
            return int(text)
        return text  # RTSP URL or device path

    @field_validator("api_url")
    @classmethod
    def _normalise_api_url(cls, value: str) -> str:
        text = value.strip().rstrip("/")
        if not text:
            raise ValueError("API_URL must not be empty")
        return text

    @field_validator("supabase_url", mode="before")
    @classmethod
    def _normalise_supabase_url(cls, value: object) -> str | None:
        if value is None:
            return None
        text = str(value).strip().rstrip("/")
        return text or None

    @field_validator("camera_id")
    @classmethod
    def _validate_camera_id(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("CAMERA_ID must not be empty")
        return text

    @field_validator("consent_mode")
    @classmethod
    def _validate_consent_mode(cls, value: str) -> str:
        text = value.strip().lower()
        if text not in ("kiosk", "open", "off"):
            raise ValueError("CONSENT_MODE must be one of: kiosk, open, off")
        return text

    @property
    def api_key_value(self) -> str:
        return self.api_key.get_secret_value()

    @property
    def supabase_service_role_key_value(self) -> str | None:
        if self.supabase_service_role_key is None:
            return None
        return self.supabase_service_role_key.get_secret_value()


def load_settings() -> Settings:
    return Settings()
