"""Pure stage-ordering and capability rules for the production engine (modules 09/14).

Everything here is a function of data the caller already fetched — a list of stage
definitions and a couple of strings. No DB, no I/O, no heavy imports, so the whole
production state machine's decision logic is unit-testable with nothing installed
(CLAUDE.md: pure core isolated from I/O; import-light packages).

Two families live here:

  * STAGE ORDER — `next_code`, `is_within_span`, `codes_in_span`, `skipped_codes`.
    `sort` is the only ordering authority (0024 seeds it in tens); nothing here
    hard-codes a stage name, so the client adding "pre-polish" between polishing and
    finishing is an INSERT, not a code change.
  * CAPABILITIES — who may tap a status vs who may move custody. This is module 14's
    lead/sub split (spec D4, client-confirmed 2026-07-27) expressed once, so the API
    gate and the UI's button-disabling read the same rule.
"""

from dataclasses import dataclass

# ─── Capabilities ────────────────────────────────────────────────────────────
# STATUS  — advance a stage, block/unblock, upload a stage photo.  ("sub" and up)
# CUSTODY — hand an item to the next workshop, receive an incoming consignment.
#           ("lead" and up.) Deliberately NOT granted to a sub: the client's own
#           words scope a sub-manager to "the status update of the products".
# TRANSIT — drive a consignment between workshops (pickup/in-transit/deliver).
#           The courier's capability; it moves goods but never production state.
# ALLOCATE— plan or re-plan a route.
CAP_STATUS = "status"
CAP_CUSTODY = "custody"
CAP_TRANSIT = "transit"
CAP_ALLOCATE = "allocate"

STAFF_LEAD = "lead"
STAFF_SUB = "sub"

_ADMIN_CAPS = frozenset({CAP_STATUS, CAP_CUSTODY, CAP_TRANSIT, CAP_ALLOCATE})
_STAFF_CAPS = {
    STAFF_LEAD: frozenset({CAP_STATUS, CAP_CUSTODY}),
    STAFF_SUB: frozenset({CAP_STATUS}),
}


def capabilities_for(*, role: str, staff_role: str | None) -> frozenset[str]:
    """What the caller may do at ONE workshop.

    `role` is the coarse `salespersons.role`; `staff_role` is their
    `workshop_staff.role` at the workshop in question (None = not on that roster).
    Splitting them is module 14 D1: the coarse role decides which app you land in,
    the roster row decides what you may do once you are there.

    Owner/admin get everything everywhere — they are the escape hatch when a manager
    is unreachable, and every one of their actions is audited.
    """
    if role in ("owner", "admin"):
        return _ADMIN_CAPS
    if role == "salesperson":
        # Sales plan production but never execute it (api/production.py allocate).
        return frozenset({CAP_ALLOCATE})
    if role == "delivery":
        return frozenset({CAP_TRANSIT})
    if role == "workshop_manager":
        return _STAFF_CAPS.get(staff_role or "", frozenset())
    return frozenset()


def has_capability(cap: str, *, role: str, staff_role: str | None) -> bool:
    return cap in capabilities_for(role=role, staff_role=staff_role)


# ─── Stage order ─────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Stage:
    """One row of production_stage_defs, as far as the pure layer cares."""

    code: str
    sort: int
    photo_required: bool = False


def to_stages(rows: list[dict]) -> tuple[Stage, ...]:
    """Normalise repo rows (or template dicts) into sorted Stage tuples.

    Sorting here rather than trusting the caller's ORDER BY means a hand-built list
    in a test behaves identically to one that came from SQL.
    """
    stages = [
        Stage(
            code=str(r["code"]),
            sort=int(r["sort"]),
            photo_required=bool(r.get("photo_required", False)),
        )
        for r in rows
    ]
    return tuple(sorted(stages, key=lambda s: s.sort))


def by_code(stages: tuple[Stage, ...]) -> dict[str, Stage]:
    return {s.code: s for s in stages}


def sort_of(stages: tuple[Stage, ...], code: str | None) -> int | None:
    if code is None:
        return None
    for s in stages:
        if s.code == code:
            return s.sort
    return None


def first_code(stages: tuple[Stage, ...]) -> str | None:
    return stages[0].code if stages else None


def last_code(stages: tuple[Stage, ...]) -> str | None:
    return stages[-1].code if stages else None


def next_code(stages: tuple[Stage, ...], code: str) -> str | None:
    """The stage after `code`, or None if it is the last. Mirrors the SQL in
    production_event_apply() (0024) so the API's preview of "what happens next"
    can never disagree with what the trigger actually does."""
    current = sort_of(stages, code)
    if current is None:
        return None
    for s in stages:
        if s.sort > current:
            return s.code
    return None


def codes_in_span(stages: tuple[Stage, ...], stage_from: str, stage_to: str) -> tuple[str, ...]:
    """Every stage code from `stage_from` to `stage_to`, inclusive. Empty if either
    code is unknown or the span runs backwards."""
    lo = sort_of(stages, stage_from)
    hi = sort_of(stages, stage_to)
    if lo is None or hi is None or lo > hi:
        return ()
    return tuple(s.code for s in stages if lo <= s.sort <= hi)


def is_within_span(stages: tuple[Stage, ...], code: str, stage_from: str, stage_to: str) -> bool:
    """Is `code` inside a leg's stage span?

    THE routing guard: it is what stops workshop A from ticking off the stages that
    belong to workshop B (module 14, module-09 guard 3).
    """
    return code in codes_in_span(stages, stage_from, stage_to)


def skipped_codes(stages: tuple[Stage, ...], current: str, target: str) -> tuple[str, ...]:
    """Stages an admin override jumps over: [current, target).

    Returned in ASCENDING sort order, which is not cosmetic — the caller inserts a
    `done` event per code, and production_event_apply()'s monotonic guard silently
    drops any event that would move current_stage backwards. Descending order would
    leave the item parked at the first inserted stage (STATE.md, discoveries for 09).
    """
    lo = sort_of(stages, current)
    hi = sort_of(stages, target)
    if lo is None or hi is None or hi <= lo:
        return ()
    return tuple(s.code for s in stages if lo <= s.sort < hi)


def photo_required_for(stages: tuple[Stage, ...], code: str) -> bool:
    stage = by_code(stages).get(code)
    return bool(stage and stage.photo_required)
