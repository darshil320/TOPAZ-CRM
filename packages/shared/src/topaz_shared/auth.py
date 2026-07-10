"""LinkSalespersonRequest — dashboard → /api/auth/link-salesperson contract."""

from uuid import UUID

from pydantic import BaseModel, field_validator


class LinkSalespersonRequest(BaseModel):
    auth_uid: UUID
    phone: str

    @field_validator("phone")
    @classmethod
    def require_nonempty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("phone is required")
        return v
