"""Order status transition rules — pure, unit-tested, no I/O.

The single source of truth for which order status changes are legal. The API
guards on this map (409 on an illegal move); the DB audit trigger records each
accepted transition. Production auto-moves (2B) also go through this map.
"""

# from-status -> set of allowed next statuses.
ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    "confirmed": frozenset({"in_production", "cancelled"}),
    "in_production": frozenset({"ready"}),
    "ready": frozenset({"delivered"}),
    "delivered": frozenset({"installed"}),
    "installed": frozenset({"closed"}),
    "closed": frozenset(),
    "cancelled": frozenset(),
}

# Transitions that must carry a reason (audited).
_REASON_REQUIRED = frozenset({"cancelled"})


def can_transition(from_status: str, to_status: str) -> bool:
    return to_status in ALLOWED_TRANSITIONS.get(from_status, frozenset())


def requires_reason(to_status: str) -> bool:
    return to_status in _REASON_REQUIRED
