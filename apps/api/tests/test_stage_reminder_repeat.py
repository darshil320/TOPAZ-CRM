"""Tests for the DAILY stage reminder repeat (migration 0045).

0035 fired a stage reminder once and never again. The client asked for the opposite: keep
reminding, every day, until the stage is past. These tests pin the three things that
change and the two things that must NOT change.

No DB and no ML deps: the SQL predicates are asserted as text (the queries are built as
strings in the repository, so their shape IS testable without a server), and the message
copy is pure. The actual query results are integration-tested against Postgres.
"""

import pytest

from src.repositories import stage_plan_repo as repo
from src.tasks import stage_reminders as sr


# ─── The claim window: once per IST day, not once ever ───────────────────────
def test_reminded_at_is_null_is_no_longer_the_sole_gate():
    """0035 claimed only `WHERE reminded_at IS NULL` — the single-fire tombstone.

    `reminded_at IS NULL` legitimately SURVIVES as one branch (a row that has never fired
    must fire), so its mere presence proves nothing. What must be true is that it is
    OR'd with the day-boundary branch: if it were still the only condition, the repeat
    would silently never happen — the task would run daily, claim nothing, and look
    perfectly healthy in the logs.
    """
    sql = _claim_sql()
    assert f"reminded_at IS NULL OR reminded_at < {repo._IST_TODAY_START}" in sql


def test_claim_is_conditional_on_the_ist_day_boundary():
    """The claim re-checks the day window itself — the SELECT is not the guard.

    Between due_reminders() and claim_reminder() another worker may have sent today's
    message. Only the conditional UPDATE settles it, so the predicate must be IN the
    UPDATE.
    """
    sql = _claim_sql()
    assert "UPDATE order_item_stage_plan" in sql
    assert "Asia/Kolkata" in sql
    assert "reminder_count + 1" in sql
    assert "RETURNING reminder_count" in sql


def test_day_boundary_is_calendar_ist_not_a_rolling_24h():
    """A rolling window drifts later each day and eventually skips a calendar day.

    date_trunc on the IST wall clock is what makes "every day" mean every day.
    """
    assert "date_trunc('day'" in repo._IST_TODAY_START
    assert "Asia/Kolkata" in repo._IST_TODAY_START
    assert "interval" not in repo._IST_TODAY_START.lower()


def test_scan_and_claim_share_one_day_boundary_expression():
    """Two different definitions of "today" would let a row fire twice or never."""
    assert repo._IST_TODAY_START in _claim_sql()
    assert repo._IST_TODAY_START in _scan_sql()


# ─── The repeat has a ceiling, in both places ────────────────────────────────
def test_repeat_is_capped():
    assert repo.MAX_REMINDERS > 1, "a cap of 1 would restore 0035's single-fire behaviour"
    assert repo.MAX_REMINDERS <= 30, "a nag people mute takes the real alerts with it"


def test_task_and_repository_agree_on_the_cap():
    """One definition, re-exported — not two constants that drift apart."""
    assert sr._MAX_REMINDERS is repo.MAX_REMINDERS


def test_cap_is_enforced_in_the_claim_not_only_in_the_scan():
    """The scan can be stale; the claim is the write. The ceiling belongs in both."""
    assert "reminder_count < :max_reminders" in _claim_sql()
    assert "reminder_count < :max_reminders" in _scan_sql()


def test_migration_index_predicate_matches_the_python_cap():
    """0045's partial index hard-codes the cap (an index predicate cannot read config).

    If they drift, rows past the Python cap stay in the index (waste) or rows under it
    fall out (silently no reminder). This test is the tripwire the migration comment
    promises.
    """
    from pathlib import Path

    migration = (
        Path(__file__).resolve().parents[3]
        / "supabase" / "migrations" / "0045_stage_reminder_daily_repeat.sql"
    ).read_text()
    assert f"reminder_count < {repo.MAX_REMINDERS}" in migration


# ─── What must STILL stop the reminder ───────────────────────────────────────
@pytest.mark.parametrize(
    "predicate, why",
    [
        ("p.skipped = false", "the operator marked the stage as not applicable"),
        ("p.remind = true", "the operator turned reminders off for this stage"),
        ("oi.production_done_at IS NULL", "the item is finished; the schedule is moot"),
        ("e.kind = 'done'", "THE ending: 'until he's past that stage'"),
        ("p.snoozed_until", "the manager asked for a few more hours"),
    ],
)
def test_daily_repeat_did_not_drop_an_existing_stop_condition(predicate, why):
    """Making the reminder repeat must not make it unstoppable."""
    assert predicate in _scan_sql(), why


def test_stage_marked_done_is_what_ends_the_repeat():
    """The repeat ends by the work happening, not by anyone remembering to mute it."""
    sql = _scan_sql()
    assert "NOT EXISTS" in sql
    assert "production_events" in sql


# ─── The message copy ────────────────────────────────────────────────────────
def _row(**over):
    row = {
        "stage_code": "upholstery",
        "stage_label_en": "Upholstery",
        "due_at": None,
        "blocked": False,
    }
    return {**row, **over}


def test_first_reminder_reads_exactly_as_before():
    """Reminder 1 on a one-hour-late stage must not be cluttered with a counter."""
    line = sr._issue_line(_row(), nth=1)
    assert "reminder" not in line.lower()
    assert "Upholstery" in line


def test_repeat_reminders_say_which_one_they_are():
    """Identical daily messages read as a malfunction and hide how long it has slipped."""
    line = sr._issue_line(_row(), nth=3)
    assert f"reminder 3 of {repo.MAX_REMINDERS}" in line


def test_blocked_prefix_survives_the_repeat_suffix():
    line = sr._issue_line(_row(blocked=True), nth=4)
    assert line.startswith("Blocked —")
    assert "reminder 4" in line


# ─── Helpers: pull the SQL text the repository actually sends ────────────────
def _sql_of(func) -> str:
    """The literal SQL a repository coroutine builds, captured without a database.

    The queries are assembled as strings inside the function, so a fake session that
    records the statement it is handed is enough to assert their shape — no Postgres, no
    async driver, no fixtures.
    """
    import asyncio

    captured = []

    class _Result:
        def mappings(self):
            return self

        def all(self):
            return []

        def first(self):
            return None

    class _Session:
        async def execute(self, statement, params=None):
            captured.append(str(statement))
            return _Result()

    asyncio.run(func(_Session()))
    return captured[0]


def _scan_sql() -> str:
    return _sql_of(lambda s: repo.due_reminders(s, limit=1))


def _claim_sql() -> str:
    return _sql_of(lambda s: repo.claim_reminder(s, "00000000-0000-0000-0000-000000000000"))
