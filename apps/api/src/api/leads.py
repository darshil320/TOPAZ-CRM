"""Leads API — manual enquiry capture (form + table) and conversion to a customer.

Writes go through here rather than straight to Supabase because three rules cannot
live in RLS: the E.164 phone validation with a usable message, the status-transition
guard (services/lead_status.py), and — the important one — the consent record that
conversion has to create.

─── WHY CONVERSION DOES NOT GRANT CONSENT ────────────────────────────────────
`customers.consent_id` is NOT NULL (0002), so converting a lead must create a consent
row. It creates one with personal_data=true and face_tracking/whatsapp_marketing
FALSE, method='app'.

That asymmetry is deliberate and is not a placeholder to be "fixed" later:
  * personal_data=true is truthful — the customer gave their name, number and address
    to a salesperson in order to be contacted about this enquiry.
  * face_tracking=false because nobody has been offered, or accepted, biometric
    capture. A staff member typing a form is not the data principal consenting, and
    DPDPA requires that consent be explicit and individually recorded (0002 header,
    CLAUDE.md constraint 1). Writing true here would fabricate it.
  * whatsapp_marketing=false for the same reason — an enquiry is not opt-in to
    marketing.

The customer grants the other two at the kiosk, through the flow that exists for it.
Until then the converted customer simply has no face record, which is correct.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status as http_status
from pydantic import BaseModel, Field, field_validator

from ..database import get_api_session
from ..repositories import enrollment_repo, lead_repo as repo
from ..services import lead_status
from . import authz
from .deps import get_caller_uid, require_dashboard_key

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/leads", dependencies=[Depends(require_dashboard_key)])

_SOURCES = ("walk_in", "phone", "referral", "instagram", "facebook", "google", "whatsapp", "other")


def _clean_phone(v: str) -> str:
    """Accept what a salesperson actually types; reject what cannot be called back.

    Deliberately permissive about separators and the country code (a bare 10-digit
    local number is the common case), strict about digit count — the whole value of a
    lead is that someone can ring it.
    """
    digits = lead_status.normalise_phone_digits(v)
    if len(digits) < 10:
        raise ValueError("phone must contain at least 10 digits")
    if len(digits) > 15:
        raise ValueError("phone has too many digits")
    return v.strip()


class LeadCreate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    phone: str = Field(max_length=32)
    society: str | None = Field(default=None, max_length=200)
    address: str | None = Field(default=None, max_length=1000)
    requirement: str | None = Field(default=None, max_length=2000)
    comments: str | None = Field(default=None, max_length=2000)
    source: str = "walk_in"
    source_detail: str | None = Field(default=None, max_length=200)
    assigned_to: UUID | None = None

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return _clean_phone(v)

    @field_validator("source")
    @classmethod
    def _source(cls, v: str) -> str:
        if v not in _SOURCES:
            raise ValueError(f"source must be one of {', '.join(_SOURCES)}")
        return v


class LeadUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=32)
    society: str | None = Field(default=None, max_length=200)
    address: str | None = Field(default=None, max_length=1000)
    requirement: str | None = Field(default=None, max_length=2000)
    comments: str | None = Field(default=None, max_length=2000)
    source: str | None = None
    source_detail: str | None = Field(default=None, max_length=200)
    assigned_to: UUID | None = None

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str | None) -> str | None:
        return None if v is None else _clean_phone(v)

    @field_validator("source")
    @classmethod
    def _source(cls, v: str | None) -> str | None:
        if v is not None and v not in _SOURCES:
            raise ValueError(f"source must be one of {', '.join(_SOURCES)}")
        return v


class StatusChange(BaseModel):
    status: str
    lost_reason: str | None = Field(default=None, max_length=500)


@router.post("", status_code=http_status.HTTP_201_CREATED)
async def create_lead(body: LeadCreate, auth_uid: str = Depends(get_caller_uid)):
    async with get_api_session() as session:
        # created_by comes from the verified token, never from the body: it is what makes
        # creator-scoped edit enforceable at all (see authz.assert_can_edit_lead).
        caller = await authz.resolve_caller(session, auth_uid)
        lead = await repo.create_lead(
            session, created_by=caller.salesperson_id, **body.model_dump()
        )
        await session.commit()
    logger.info("Lead %s created (source=%s)", lead["id"], lead["source"])
    return lead


@router.get("")
async def list_leads(
    status: str | None = Query(default=None),
    assigned_to: UUID | None = Query(default=None),
    search: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    if status and status not in lead_status.ALLOWED_TRANSITIONS:
        raise HTTPException(status_code=422, detail=f"unknown status '{status}'")
    async with get_api_session() as session:
        return {
            "leads": await repo.list_leads(
                session, status=status, assigned_to=assigned_to,
                search=search, limit=limit, offset=offset,
            ),
            "counts": await repo.counts_by_status(session),
        }


@router.get("/{lead_id}")
async def get_lead(lead_id: UUID):
    async with get_api_session() as session:
        lead = await repo.get_lead(session, lead_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="lead not found")
    return lead


@router.patch("/{lead_id}")
async def update_lead(
    lead_id: UUID, body: LeadUpdate, auth_uid: str = Depends(get_caller_uid)
):
    """Correct a captured lead's fields. Creator (or owner) only — see authz."""
    async with get_api_session() as session:
        caller = await authz.resolve_caller(session, auth_uid)
        lead = await repo.get_lead(session, lead_id)
        # 404 before 403: answering 403 for an id that does not exist would confirm a
        # lead is there. leads_select is open to every salesperson, so a lead the caller
        # can see but not edit is a plain 403.
        if lead is None:
            raise HTTPException(status_code=404, detail="lead not found")
        authz.assert_can_edit_lead(caller, lead)
        fields = dict(body.model_dump(exclude_unset=True))
        lead = await repo.update_lead(session, lead_id, **fields)
        await session.commit()
    return lead


@router.post("/{lead_id}/status")
async def change_status(
    lead_id: UUID, body: StatusChange, auth_uid: str = Depends(get_caller_uid)
):
    """Progress a lead. Deliberately NOT creator-gated: 0046's own header notes that
    "the person who picks up the phone is rarely the one who took the original enquiry",
    and a lead only its author can progress dies when its author is off. The caller is
    still resolved so the actor is identified and the inactive-staff gate applies."""
    async with get_api_session() as session:
        await authz.resolve_caller(session, auth_uid)
        lead = await repo.get_lead(session, lead_id)
        if lead is None:
            raise HTTPException(status_code=404, detail="lead not found")

        # 409, not 422: the request is well-formed, the lead's current state forbids it.
        if not lead_status.can_transition(lead["status"], body.status):
            raise HTTPException(
                status_code=409,
                detail=f"cannot move a lead from '{lead['status']}' to '{body.status}'",
            )
        if lead_status.requires_reason(body.status) and not (body.lost_reason or "").strip():
            raise HTTPException(
                status_code=422, detail="lost_reason is required when marking a lead lost"
            )
        # Conversion creates a customer and must go through /convert, which owns the
        # consent record. Allowing it here would leave a 'converted' lead with no customer.
        if body.status == "converted":
            raise HTTPException(
                status_code=409, detail="use POST /leads/{id}/convert to convert a lead"
            )

        # Follow-ups budgeted the moment active contact work starts (see
        # lead_status.should_reset_follow_ups — fires at most once, on new->contacted).
        reset_follow_ups = lead_status.should_reset_follow_ups(lead["status"], body.status)
        updated = await repo.set_status(
            session, lead_id, status=body.status, lost_reason=body.lost_reason,
            reset_follow_ups=reset_follow_ups,
        )
        await session.commit()
    return updated


@router.post("/{lead_id}/follow-up")
async def log_follow_up(lead_id: UUID, auth_uid: str = Depends(get_caller_uid)):
    """Record a follow-up call. Deliberately NOT creator-gated — same reasoning as
    /status and /convert: whoever calls today logs it, and a call the lead's
    original captor cannot log because they're off is a lost follow-up.

    A follow-up can happen without any status change (e.g. re-calling a
    'qualified' lead who hasn't decided yet), so this is its own route rather
    than folded into /status.
    """
    async with get_api_session() as session:
        await authz.resolve_caller(session, auth_uid)
        lead = await repo.get_lead(session, lead_id)
        if lead is None:
            raise HTTPException(status_code=404, detail="lead not found")
        if lead["follow_ups_remaining"] <= 0:
            raise HTTPException(
                status_code=409,
                detail="No follow-ups remaining on this lead — mark it lost or move it forward.",
            )
        updated = await repo.log_follow_up(session, lead_id)
        if updated is None:
            # Lost the race described in log_follow_up's docstring — another caller
            # just consumed the last follow-up between the check above and the UPDATE.
            raise HTTPException(status_code=409, detail="No follow-ups remaining on this lead.")
        await session.commit()
    return updated


@router.post("/{lead_id}/convert")
async def convert_lead(lead_id: UUID, auth_uid: str = Depends(get_caller_uid)):
    """Create (or reuse) the customer for a qualified lead. See module docstring on consent.

    Not creator-gated, for the same reason as /status: whoever closes the lead converts it.
    """
    async with get_api_session() as session:
        await authz.resolve_caller(session, auth_uid)
        lead = await repo.get_lead(session, lead_id)
        if lead is None:
            raise HTTPException(status_code=404, detail="lead not found")
        if lead["status"] == "converted":
            raise HTTPException(status_code=409, detail="lead is already converted")
        if lead["status"] not in lead_status.CONVERTIBLE_FROM:
            raise HTTPException(
                status_code=409,
                detail=f"only a qualified lead can be converted (this one is '{lead['status']}')",
            )

        # Reuse the existing person when the number already belongs to a customer, rather
        # than creating a second row for someone the showroom already knows.
        existing = await repo.find_customer_by_phone(session, lead["phone"])
        if existing is not None:
            customer_id = existing
        else:
            digits = lead_status.normalise_phone_digits(lead["phone"])
            _, customer_id = await enrollment_repo.enroll_customer(
                session,
                name=lead["name"],
                phone=lead["phone"],
                wa_id=digits or None,
                primary_interest=lead["requirement"],
                face_tracking=False,        # never from a staff-entered form — see docstring
                personal_data=True,
                whatsapp_marketing=False,
            )

        updated = await repo.mark_converted(session, lead_id, customer_id=customer_id)
        await session.commit()

    logger.info("Lead %s converted to customer %s", lead_id, customer_id)
    return {
        "lead": updated,
        "customer_id": str(customer_id),
        "reused_existing": existing is not None,
    }
