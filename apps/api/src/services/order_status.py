"""Order status transition rules — pure, unit-tested, no I/O.

The single source of truth for which order status changes are legal. The API
guards on this map (409 on an illegal move); the DB audit trigger records each
accepted transition. Production auto-moves (2B) also go through this map.
"""

# from-status -> set of allowed next statuses.
#
# CANCELLATION IS ALLOWED WHILE THE GOODS ARE STILL OURS — confirmed, in_production
# and ready. It used to be confirmed-only, which meant the first production event
# (which auto-moves the order to in_production, 0024) locked cancellation out
# permanently: a customer who pulled out mid-build left the order stuck advancing
# through a pipeline nobody was working, because there was no legal way to say so.
#
# It stops at `delivered`. Once the goods are with the customer, undoing the sale is a
# RETURN — goods coming back, a credit note, possibly a restocking decision — not a
# status flip, and nothing in this schema models that. Cancelling a delivered order
# here would assert the furniture is not with the customer when it is.
ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    "confirmed": frozenset({"in_production", "cancelled"}),
    "in_production": frozenset({"ready", "cancelled"}),
    "ready": frozenset({"delivered", "cancelled"}),
    "delivered": frozenset({"installed"}),
    "installed": frozenset({"closed"}),
    "closed": frozenset(),
    "cancelled": frozenset(),
}

# Statuses a cancellation may be entered from. Derived from the map above rather than
# written twice — the two must never disagree about what is cancellable.
CANCELLABLE_FROM: frozenset[str] = frozenset(
    frm for frm, allowed in ALLOWED_TRANSITIONS.items() if "cancelled" in allowed
)

# Transitions that must carry a reason (audited).
_REASON_REQUIRED = frozenset({"cancelled"})


def can_transition(from_status: str, to_status: str) -> bool:
    return to_status in ALLOWED_TRANSITIONS.get(from_status, frozenset())


def requires_reason(to_status: str) -> bool:
    return to_status in _REASON_REQUIRED
