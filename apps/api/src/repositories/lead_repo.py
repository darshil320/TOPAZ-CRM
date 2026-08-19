"""Lead persistence. SQL only — transition legality lives in services/lead_status.py."""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..services.lead_status import phone_match_key

_COLUMNS = (
    "id, name, phone, society, address, requirement, comments, source, source_detail,"
    " status, lost_reason, assigned_to, linked_customer_id, converted_customer_id,"
    " converted_at, created_by, created_at, updated_at"
)


async def find_customer_by_phone(session: AsyncSession, phone: str) -> UUID | None:
    """Existing customer with the same local number, or None.

    Matches on the TRAILING local digits of phone and wa_id so "+91 94265 29230",
    "9426529230" and the wa_id "919426529230" all resolve to the same person — see
    phone_match_key. Newest first: if an old duplicate customer row exists, the live
    one is the one staff are actually using.
    """
    key = phone_match_key(phone)
    if not key:
        return None
    row = (
        await session.execute(
            text(
                "SELECT id FROM customers"
                " WHERE right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), :n) = :key"
                "    OR right(regexp_replace(coalesce(wa_id, ''), '[^0-9]', '', 'g'), :n) = :key"
                " ORDER BY created_at DESC LIMIT 1"
            ),
            {"key": key, "n": len(key)},
        )
    ).first()
    return None if row is None else UUID(str(row[0]))


async def create_lead(session: AsyncSession, *, created_by: UUID | None, **fields) -> dict:
    """Insert a lead, auto-linking it to a matching customer when one exists.

    phone_digits is intentionally NOT passed: the leads_phone_digits trigger owns it, so
    every write path (this one, a future import, psql) produces the same match key.
    """
    linked = await find_customer_by_phone(session, fields["phone"])
    row = (
        await session.execute(
            text(
                "INSERT INTO leads (name, phone, society, address, requirement, comments,"
                " source, source_detail, status, assigned_to, linked_customer_id, created_by)"
                " VALUES (:name, :phone, :society, :address, :requirement, :comments,"
                " :source, :source_detail, :status, :assigned_to, :linked, :created_by)"
                f" RETURNING {_COLUMNS}"
            ),
            {
                "name": fields.get("name"),
                "phone": fields["phone"],
                "society": fields.get("society"),
                "address": fields.get("address"),
                "requirement": fields.get("requirement"),
                "comments": fields.get("comments"),
                "source": fields.get("source") or "walk_in",
                "source_detail": fields.get("source_detail"),
                "status": fields.get("status") or "new",
                "assigned_to": str(fields["assigned_to"]) if fields.get("assigned_to") else None,
                "linked": str(linked) if linked else None,
                "created_by": str(created_by) if created_by else None,
            },
        )
    ).mappings().one()
    return dict(row)


async def list_leads(
    session: AsyncSession,
    *,
    status: str | None = None,
    assigned_to: UUID | None = None,
    search: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    """Newest first. `search` matches name, phone digits, society or requirement."""
    clauses, params = [], {"limit": min(limit, 200), "offset": max(offset, 0)}

    if status:
        clauses.append("status = :status")
        params["status"] = status
    if assigned_to:
        clauses.append("assigned_to = :assigned_to")
        params["assigned_to"] = str(assigned_to)
    if search and search.strip():
        term = search.strip()
        digits = phone_match_key(term)
        # A numeric search is a phone lookup; anything else is a text lookup. Running
        # both against one term would make "9426" scan the requirement text too.
        if digits and digits == "".join(c for c in term if c.isdigit()):
            clauses.append("phone_digits LIKE :digits")
            params["digits"] = f"%{digits}%"
        else:
            clauses.append(
                "(name ILIKE :term OR society ILIKE :term OR requirement ILIKE :term)"
            )
            params["term"] = f"%{term}%"

    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = (
        await session.execute(
            text(
                f"SELECT {_COLUMNS} FROM leads{where}"
                " ORDER BY created_at DESC LIMIT :limit OFFSET :offset"
            ),
            params,
        )
    ).mappings().all()
    return [dict(r) for r in rows]


async def get_lead(session: AsyncSession, lead_id: UUID) -> dict | None:
    row = (
        await session.execute(
            text(f"SELECT {_COLUMNS} FROM leads WHERE id = :id"), {"id": str(lead_id)}
        )
    ).mappings().first()
    return None if row is None else dict(row)


async def update_lead(session: AsyncSession, lead_id: UUID, **fields) -> dict | None:
    """Patch the editable columns. Status changes go through set_status instead."""
    editable = (
        "name", "phone", "society", "address", "requirement",
        "comments", "source", "source_detail", "assigned_to",
    )
    sets, params = [], {"id": str(lead_id)}
    for col in editable:
        if col in fields:
            value = fields[col]
            sets.append(f"{col} = :{col}")
            params[col] = str(value) if col == "assigned_to" and value else value
    if not sets:
        return await get_lead(session, lead_id)

    sets.append("updated_at = now()")
    row = (
        await session.execute(
            text(f"UPDATE leads SET {', '.join(sets)} WHERE id = :id RETURNING {_COLUMNS}"),
            params,
        )
    ).mappings().first()
    return None if row is None else dict(row)


async def set_status(
    session: AsyncSession, lead_id: UUID, *, status: str, lost_reason: str | None = None
) -> dict | None:
    row = (
        await session.execute(
            text(
                "UPDATE leads SET status = :status, lost_reason = :reason, updated_at = now()"
                f" WHERE id = :id RETURNING {_COLUMNS}"
            ),
            {"id": str(lead_id), "status": status, "reason": lost_reason},
        )
    ).mappings().first()
    return None if row is None else dict(row)


async def mark_converted(
    session: AsyncSession, lead_id: UUID, *, customer_id: UUID
) -> dict | None:
    row = (
        await session.execute(
            text(
                "UPDATE leads SET status = 'converted', converted_customer_id = :cid,"
                " linked_customer_id = coalesce(linked_customer_id, :cid),"
                " converted_at = now(), updated_at = now()"
                f" WHERE id = :id RETURNING {_COLUMNS}"
            ),
            {"id": str(lead_id), "cid": str(customer_id)},
        )
    ).mappings().first()
    return None if row is None else dict(row)


async def counts_by_status(session: AsyncSession) -> dict[str, int]:
    rows = (
        await session.execute(text("SELECT status, count(*) AS n FROM leads GROUP BY status"))
    ).mappings().all()
    return {r["status"]: int(r["n"]) for r in rows}
