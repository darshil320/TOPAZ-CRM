"""RecognitionEvent — the contract the edge worker POSTs to /api/recognition."""

from datetime import datetime, timezone
from uuid import UUID

from pydantic import BaseModel, field_validator

EMBEDDING_DIMENSIONS = 512


class RecognitionEvent(BaseModel):
    raw_event_id: UUID
    embedding: list[float]
    quality_score: float
    photo_key: str | None = None
    camera_id: str
    captured_at: datetime

    @field_validator("captured_at")
    @classmethod
    def require_timezone(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("captured_at must be timezone-aware")
        return v.astimezone(timezone.utc)

    @field_validator("photo_key")
    @classmethod
    def empty_to_none(cls, v: str | None) -> str | None:
        return None if v == "" else v

    @field_validator("embedding")
    @classmethod
    def check_dimensions(cls, v: list[float]) -> list[float]:
        if len(v) != EMBEDDING_DIMENSIONS:
            raise ValueError(
                f"embedding must have {EMBEDDING_DIMENSIONS} dimensions, got {len(v)}"
            )
        return v
