"""Enrollment repository — consent + customer + face_embedding writes for Layer 3."""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def enroll_customer(
    session: AsyncSession,
    *,
    name: str | None,
    phone: str | None,
    wa_id: str | None,
    primary_interest: str | None,
    face_tracking: bool,
    personal_data: bool,
    whatsapp_marketing: bool,
) -> tuple[UUID, UUID]:
    """Create a consent row and a customer row; return (consent_id, customer_id).

    If a customer with the same wa_id already exists, update their name and
    primary_interest rather than creating a duplicate (ON CONFLICT … DO UPDATE).
    """
    consent_row = await session.execute(
        text(
            "INSERT INTO consents (face_tracking, personal_data, whatsapp_marketing, method)"
            " VALUES (:ft, :pd, :wm, 'kiosk')"
            " RETURNING id"
        ),
        {"ft": face_tracking, "pd": personal_data, "wm": whatsapp_marketing},
    )
    consent_id = UUID(str(consent_row.scalar_one()))

    if wa_id:
        customer_row = await session.execute(
            text(
                "INSERT INTO customers"
                " (consent_id, name, phone, wa_id, primary_interest, ai_followup_enabled, handler_mode)"
                " VALUES (:cid, :name, :phone, :wa_id, :pi, true, 'ai')"
                " ON CONFLICT (wa_id) DO UPDATE"
                "   SET name = COALESCE(EXCLUDED.name, customers.name),"
                "       primary_interest = COALESCE(EXCLUDED.primary_interest, customers.primary_interest),"
                "       updated_at = now()"
                " RETURNING id"
            ),
            {"cid": str(consent_id), "name": name, "phone": phone, "wa_id": wa_id, "pi": primary_interest},
        )
    else:
        customer_row = await session.execute(
            text(
                "INSERT INTO customers"
                " (consent_id, name, phone, wa_id, primary_interest, ai_followup_enabled, handler_mode)"
                " VALUES (:cid, :name, :phone, NULL, :pi, true, 'ai')"
                " RETURNING id"
            ),
            {"cid": str(consent_id), "name": name, "phone": phone, "pi": primary_interest},
        )

    customer_id = UUID(str(customer_row.scalar_one()))
    return consent_id, customer_id


async def enroll_face(
    session: AsyncSession,
    *,
    customer_id: UUID,
    embedding: list[float],
    quality_score: float | None,
    camera_id: str,
) -> UUID:
    """Store a face embedding for an enrolled customer; return the embedding row id.

    The DB trigger `face_embedding_consent_gate` verifies face_tracking consent
    before allowing the INSERT — no need to re-check here.
    """
    vec_literal = "[" + ",".join(str(f) for f in embedding) + "]"
    row = await session.execute(
        text(
            f"INSERT INTO face_embeddings (customer_id, embedding, model_version, quality_score)"
            f" VALUES (:cid, '{vec_literal}'::vector, 'buffalo_l', :qs)"
            f" RETURNING id"
        ),
        {"cid": str(customer_id), "qs": quality_score},
    )
    return UUID(str(row.scalar_one()))
