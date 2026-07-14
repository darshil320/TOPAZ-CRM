"""Enrollment repository — consent + customer + face_embedding writes for Layer 3.

Consent-token contract (§19-E): the token IS the consent row's UUID. The kiosk
creates consent + customer; the entrance camera polls find_pending_consent_token
and attaches it to the next detection; redeem_consent_customer validates it and
returns the customer awaiting a face.
"""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# A token can be redeemed slightly after it stops being advertised as pending —
# the edge may hold a cached token while the customer walks to the camera.
REDEEM_GRACE_MINUTES = 15


async def enroll_customer(
    session: AsyncSession,
    *,
    name: str | None,
    phone: str | None,
    wa_id: str | None,
    primary_interest: str | None,
    interest_summary: str | None = None,
    face_tracking: bool,
    personal_data: bool,
    whatsapp_marketing: bool,
) -> tuple[UUID, UUID]:
    """Create a consent row and a customer row; return (consent_id, customer_id).

    If a customer with the same wa_id already exists, update their name,
    primary_interest and interest_summary rather than creating a duplicate
    (ON CONFLICT … DO UPDATE). COALESCE keeps existing values when the new
    enrollment omits a field — a returning customer never loses prior notes.
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
                " (consent_id, name, phone, wa_id, primary_interest, interest_summary,"
                "  ai_followup_enabled, handler_mode)"
                " VALUES (:cid, :name, :phone, :wa_id, :pi, :isum, true, 'ai')"
                " ON CONFLICT (wa_id) DO UPDATE"
                "   SET name = COALESCE(EXCLUDED.name, customers.name),"
                "       primary_interest = COALESCE(EXCLUDED.primary_interest, customers.primary_interest),"
                "       interest_summary = COALESCE(EXCLUDED.interest_summary, customers.interest_summary),"
                "       updated_at = now()"
                " RETURNING id"
            ),
            {
                "cid": str(consent_id), "name": name, "phone": phone, "wa_id": wa_id,
                "pi": primary_interest, "isum": interest_summary,
            },
        )
    else:
        customer_row = await session.execute(
            text(
                "INSERT INTO customers"
                " (consent_id, name, phone, wa_id, primary_interest, interest_summary,"
                "  ai_followup_enabled, handler_mode)"
                " VALUES (:cid, :name, :phone, NULL, :pi, :isum, true, 'ai')"
                " RETURNING id"
            ),
            {
                "cid": str(consent_id), "name": name, "phone": phone,
                "pi": primary_interest, "isum": interest_summary,
            },
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
            "INSERT INTO face_embeddings (customer_id, embedding, model_version, quality_score)"
            " VALUES (:cid, cast(:vec AS vector), 'buffalo_l', :qs)"
            " RETURNING id"
        ),
        {"cid": str(customer_id), "vec": vec_literal, "qs": quality_score},
    )
    return UUID(str(row.scalar_one()))


async def find_pending_consent_token(
    session: AsyncSession,
    window_seconds: int,
) -> UUID | None:
    """Most recent kiosk enrollment still awaiting its face capture, or None.

    Pending = kiosk consent with face_tracking, not withdrawn, customer created
    within the window, and no face embedding stored yet.
    """
    result = await session.execute(
        text(
            "SELECT co.id"
            " FROM consents co JOIN customers cu ON cu.consent_id = co.id"
            " WHERE co.method = 'kiosk'"
            "   AND co.face_tracking AND co.withdrawn_at IS NULL"
            "   AND cu.created_at > now() - make_interval(secs => :window)"
            "   AND NOT EXISTS ("
            "     SELECT 1 FROM face_embeddings fe WHERE fe.customer_id = cu.id"
            "   )"
            " ORDER BY cu.created_at DESC"
            " LIMIT 1"
        ),
        {"window": window_seconds},
    )
    row = result.first()
    return UUID(str(row.id)) if row else None


async def redeem_consent_customer(
    session: AsyncSession,
    consent_id: UUID,
) -> UUID | None:
    """Validate a consent token and return the customer awaiting enrollment.

    Returns None when the token is unknown, withdrawn, lacks face_tracking,
    already has a face enrolled, or is older than the redeem grace period.

    Two-step check: first lock the customer row (FOR UPDATE) so concurrent
    redemptions serialize, then — in a fresh statement, which under READ
    COMMITTED sees anything the blocking transaction committed — verify no
    embedding exists yet. This closes the race where two near-simultaneous
    detections both redeem the same single-use token.
    """
    result = await session.execute(
        text(
            "SELECT cu.id"
            " FROM consents co JOIN customers cu ON cu.consent_id = co.id"
            " WHERE co.id = :consent_id"
            "   AND co.method = 'kiosk'"
            "   AND co.face_tracking AND co.withdrawn_at IS NULL"
            "   AND cu.created_at > now() - make_interval(mins => :grace)"
            " LIMIT 1"
            " FOR UPDATE OF cu"
        ),
        {"consent_id": str(consent_id), "grace": REDEEM_GRACE_MINUTES},
    )
    row = result.first()
    if not row:
        return None
    customer_id = UUID(str(row.id))

    existing = await session.execute(
        text("SELECT 1 FROM face_embeddings WHERE customer_id = :cid LIMIT 1"),
        {"cid": str(customer_id)},
    )
    if existing.first():
        return None
    return customer_id
