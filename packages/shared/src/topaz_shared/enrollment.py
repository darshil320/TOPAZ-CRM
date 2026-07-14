"""EnrollmentRequest — kiosk → /api/enrollment contract."""

import math
from pydantic import BaseModel, field_validator

EMBEDDING_DIMENSIONS = 512


class EnrollmentRequest(BaseModel):
    name: str | None = None
    phone: str | None = None
    wa_id: str | None = None
    primary_interest: str | None = None
    interest_summary: str | None = None
    face_tracking: bool = False
    personal_data: bool = False
    whatsapp_marketing: bool = False
    face_embedding: list[float] | None = None
    quality_score: float | None = None
    camera_id: str = "kiosk"

    @field_validator("face_embedding")
    @classmethod
    def check_embedding(cls, v: list[float] | None) -> list[float] | None:
        if v is None:
            return None
        if len(v) != EMBEDDING_DIMENSIONS:
            raise ValueError(f"face_embedding must have {EMBEDDING_DIMENSIONS} dimensions, got {len(v)}")
        if any(not math.isfinite(x) for x in v):
            raise ValueError("face_embedding values must be finite (no nan/inf)")
        return v

    @field_validator("wa_id")
    @classmethod
    def clean_wa_id(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return v.lstrip("+")

    @field_validator("phone", "primary_interest", "interest_summary")
    @classmethod
    def empty_to_none(cls, v: str | None) -> str | None:
        return None if v == "" else v
