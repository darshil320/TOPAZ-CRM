"""Lead status transition rules and phone normalisation — pure, no I/O.

Mirrors services/order_status.py: one map is the single source of truth for legal
moves, the API guards on it, and the reason-required set is derived from the map
rather than written twice.
"""

import re

# from-status -> allowed next statuses.
#
# 'contacted' is reachable from 'new' only. 'qualified' means "real budget, real
# requirement" and is the gate to conversion — a lead should not jump from 'new'
# straight to 'converted', because that skips the only step where anyone checked the
# enquiry was genuine.
#
# 'lost' is reachable from every live state: an enquiry can die at any point.
# 'converted' and 'lost' are terminal. Re-enquiring later is a NEW lead row, not a
# resurrection of this one — that keeps each row a faithful record of one enquiry.
ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    "new": frozenset({"contacted", "qualified", "lost"}),
    "contacted": frozenset({"qualified", "lost"}),
    "qualified": frozenset({"converted", "lost"}),
    "converted": frozenset(),
    "lost": frozenset(),
}

# Transitions that must carry a reason. Same rule as an order cancellation: a dead
# record with no stated cause teaches nobody anything.
_REASON_REQUIRED = frozenset({"lost"})

CONVERTIBLE_FROM: frozenset[str] = frozenset(
    frm for frm, allowed in ALLOWED_TRANSITIONS.items() if "converted" in allowed
)


def can_transition(from_status: str, to_status: str) -> bool:
    return to_status in ALLOWED_TRANSITIONS.get(from_status, frozenset())


# Follow-ups budgeted the moment a lead moves from a cold enquiry to actively
# worked. Not configurable per-lead in this feature — a fixed floor number, revisit
# only if the business asks for a per-source or per-assignee default.
DEFAULT_FOLLOW_UPS = 3


def should_reset_follow_ups(from_status: str, to_status: str) -> bool:
    """True exactly on the one-time new -> contacted edge.

    ALLOWED_TRANSITIONS makes 'contacted' reachable from 'new' only, and 'contacted'
    never re-enters 'new' — so this edge fires at most once per lead's lifetime.
    No "only if not already set" guard is needed as a result.

    A lead can also move 'new' -> 'qualified' directly (skipping 'contacted') —
    that transition does NOT reset the counter, since the counter's meaning is
    specifically "follow-ups budgeted once active contact work started".
    """
    return from_status == "new" and to_status == "contacted"


def requires_reason(to_status: str) -> bool:
    return to_status in _REASON_REQUIRED


def normalise_phone_digits(phone: str | None) -> str:
    """Digits-only match key. Mirrors the leads_set_phone_digits() trigger exactly.

    The trigger is authoritative for what lands in the column; this exists so the API
    can look up a match BEFORE inserting, and the two must agree — a divergence would
    make the dedupe silently miss.
    """
    return re.sub(r"[^0-9]", "", phone or "")


def phone_match_key(phone: str | None, *, local_length: int = 10) -> str:
    """The last `local_length` digits, for matching across country-code variants.

    A salesperson types "9426529230"; the customer's wa_id is "919426529230". Comparing
    full digit strings calls those different people. Comparing the trailing local number
    calls them the same, which is right for a single-country deployment and is why this
    is not simply normalise_phone_digits().
    """
    digits = normalise_phone_digits(phone)
    return digits[-local_length:] if len(digits) > local_length else digits
