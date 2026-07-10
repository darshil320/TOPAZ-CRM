"""Salesperson repository — first-login auth linking (§19-B)."""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def link_salesperson_by_phone(
    session: AsyncSession,
    *,
    auth_uid: UUID,
    phone: str,
) -> UUID | None:
    """Link auth_uid to the active salesperson row matching this phone number.

    Only updates a row with no auth_uid yet (or already linked to this same
    auth_uid, making the call idempotent) — never reassigns another account.
    Compares digits only: salespersons.whatsapp is stored E.164 with a leading
    '+' while Supabase auth phones arrive without one.
    """
    result = await session.execute(
        text(
            "UPDATE salespersons SET auth_uid = :auth_uid"
            " WHERE active = true"
            "   AND (auth_uid IS NULL OR auth_uid = :auth_uid)"
            "   AND regexp_replace(whatsapp, '\\D', '', 'g') = regexp_replace(:phone, '\\D', '', 'g')"
            " RETURNING id"
        ),
        {"auth_uid": str(auth_uid), "phone": phone},
    )
    row = result.first()
    return UUID(str(row.id)) if row else None
