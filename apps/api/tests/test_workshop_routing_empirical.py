"""Empirical: the workshop hierarchy, multi-workshop routes and inter-workshop
transit, against a real migrated DB (module 14 gate).

Proves, in order:

  STAFF (0029)
    1. one active lead per workshop; a sub is unbounded; promotion is atomic
    2. workshops.manager_salesperson_id is a trigger-owned denorm of the roster
    3. one active membership per (workshop, person); a person may staff two workshops

  LEGS + DEADLINES (0030)
    4. a leg whose stage span runs backwards is rejected by the DB, not just the API
    5. one `active` leg per item is a DB backstop
    6. due_at → due_date derives in Asia/Kolkata — including across the date boundary,
       which is the bug the trigger exists to prevent

  HANDOVER + RECEIVE (0031 + services/handover)
    7. completing a leg's last stage opens exactly one consignment, and the item is
       transit-locked (order_items.transit_transfer_id set by trigger)
    8. an item may not be on two open consignments (DB backstop)
    9. receive activates the next leg, re-allocates custody, flips
       order_items.workshop_id and CLEARS the transit lock — in one commit
   10. cancel returns the destination leg to pending, reopens the origin leg and
       clears the lock
   11. the append-only guard on workshop_transfer_events holds against the service role

Runs via apps/api/scripts/pgtest.sh (skipped without TEST_DATABASE_URL).
"""
import asyncio
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from src.repositories import (
    order_repo,
    production_repo,
    route_repo,
    transfer_repo,
    workshop_repo,
    workshop_staff_repo,
)
from src.services import gst, handover, route_plan, stage_flow
from src.services.route_plan import IST, LegSpec

DB_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="needs TEST_DATABASE_URL (run via pgtest.sh)")


def _async_url() -> str:
    return DB_URL.replace("postgresql://", "postgresql+asyncpg://")


def run(coro):
    return asyncio.run(coro)


def _engine():
    return create_async_engine(_async_url(), connect_args={"ssl": False})


def _session(engine):
    return async_sessionmaker(engine, expire_on_commit=False)()


# ─── fixtures-by-hand (same shape as test_production_empirical) ──────────────
async def _customer(session) -> str:
    consent = (await session.execute(text(
        "insert into consents (face_tracking, personal_data, whatsapp_marketing, method)"
        " values (true, true, true, 'kiosk') returning id"))).scalar_one()
    return (await session.execute(text(
        "insert into customers (consent_id, name) values (:c, 'Routing Test') returning id"),
        {"c": str(consent)})).scalar_one()


async def _order_with_items(session, customer_id, n: int = 1):
    items, lines = [], []
    for i in range(n):
        lt = gst.compute_line("1", "1000.00").line_total
        items.append(order_repo.OrderItem(
            description=f"Sofa{i}", qty=Decimal("1"), unit_price=Decimal("1000.00"),
            hsn="9401", gst_rate=Decimal("18.00"), line_total=lt, sort=i))
        lines.append(gst.LineInput(qty=Decimal("1"), unit_price=Decimal("1000.00"),
                                   gst_rate=Decimal("18.00")))
    totals = gst.compute_document(lines, 0, "GJ", "GJ")
    oid = await order_repo.create_order(
        session, order_no=f"ORD-{uuid4().hex[:8]}", customer_id=customer_id,
        totals=totals, items=items)
    rows = await session.execute(
        text("select id from order_items where order_id = :o order by sort, id"), {"o": str(oid)})
    return oid, [r[0] for r in rows.all()]


async def _workshop(session, label: str) -> str:
    row = await workshop_repo.create_workshop(
        session, name=f"{label}-{uuid4().hex[:6]}", type_="own")
    return row["id"]


async def _staffer(session, name: str, role: str = "workshop_manager") -> str:
    return (await session.execute(text(
        "insert into salespersons (auth_uid, name, whatsapp, role)"
        " values (:uid, :name, :wa, :role) returning id"),
        {"uid": str(uuid4()), "name": name,
         "wa": f"+9190{uuid4().int % 100000000:08d}", "role": role})).scalar_one()


async def _stage_codes(session) -> list[str]:
    rows = await session.execute(text(
        "select code from production_stage_defs where active = true order by sort"))
    return [r[0] for r in rows.all()]


async def _item(session, item_id) -> dict:
    row = await session.execute(text(
        "select current_stage, blocked, production_done_at, workshop_id, transit_transfer_id"
        " from order_items where id = :i"), {"i": str(item_id)})
    return dict(row.mappings().one())


async def _plan_two_leg_route(session, item_id, ws_a, ws_b, *, start_at=None):
    """The client's scenario: polishing at A within 5 days, finishing at B within 4.

    Expressed over the real 11 seeded stages: A owns design_approved→polishing,
    B owns finishing→dispatch.
    """
    stages = stage_flow.to_stages(await production_repo.stage_defs(session))
    specs = [
        LegSpec(ws_a, "design_approved", "polishing", planned_days=5),
        LegSpec(ws_b, "finishing", "dispatch", planned_days=4),
    ]
    planned = route_plan.plan_route(
        stages, specs, start_stage="design_approved",
        start_at=start_at or datetime(2026, 7, 27, 10, 0, tzinfo=IST),
    )
    legs = []
    for leg in planned:
        legs.append(await route_repo.insert_leg(
            session, order_item_id=item_id, seq=leg.seq, workshop_id=leg.workshop_id,
            stage_from=leg.stage_from, stage_to=leg.stage_to,
            planned_days=leg.planned_days, due_at=leg.due_at, actor_id=None))
    await route_repo.set_leg_status(session, legs[0]["id"], "active", stamp_activated=True)
    await production_repo.lock_item(session, item_id)
    await production_repo.allocate(
        session, order_item_id=item_id, workshop_id=UUID(str(ws_a)), due_date=None,
        due_at=legs[0]["due_at"], route_leg_id=legs[0]["id"],
        start_stage="design_approved", actor_id=None)
    return legs


async def _tick(session, item_id, stage_code):
    """Complete one stage the way the API does — event only, trigger does the rest."""
    return await production_repo.insert_event(
        session, order_item_id=item_id, stage_code=stage_code, kind="done")


# ════════════════════════════════════════════════════════════════════════════
# 1–3 · the staff roster
# ════════════════════════════════════════════════════════════════════════════
def test_only_one_active_lead_per_workshop():
    async def scenario():
        engine = _engine()
        try:
            async with _session(engine) as s:
                ws = await _workshop(s, "W")
                a = await _staffer(s, "Lead A")
                b = await _staffer(s, "Lead B")
                await workshop_staff_repo.add_staff(
                    s, workshop_id=UUID(str(ws)), salesperson_id=UUID(str(a)),
                    role="lead", actor_id=None)
                with pytest.raises(IntegrityError):
                    await workshop_staff_repo.add_staff(
                        s, workshop_id=UUID(str(ws)), salesperson_id=UUID(str(b)),
                        role="lead", actor_id=None)
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_promotion_is_retire_then_appoint_in_one_transaction():
    async def scenario():
        engine = _engine()
        try:
            async with _session(engine) as s:
                ws = UUID(str(await _workshop(s, "W")))
                a = UUID(str(await _staffer(s, "Old lead")))
                b = UUID(str(await _staffer(s, "New lead")))
                await workshop_staff_repo.add_staff(
                    s, workshop_id=ws, salesperson_id=a, role="lead", actor_id=None)
                await workshop_staff_repo.add_staff(
                    s, workshop_id=ws, salesperson_id=b, role="sub", actor_id=None)

                # Promote b: retire the incumbent, drop b's sub row, appoint b as lead.
                await workshop_staff_repo.deactivate_lead(s, ws)
                await workshop_staff_repo.deactivate_membership(
                    s, workshop_id=ws, salesperson_id=b)
                await workshop_staff_repo.add_staff(
                    s, workshop_id=ws, salesperson_id=b, role="lead", actor_id=None)

                assert await workshop_staff_repo.staff_role_at(
                    s, salesperson_id=b, workshop_id=ws) == "lead"
                assert await workshop_staff_repo.staff_role_at(
                    s, salesperson_id=a, workshop_id=ws) is None
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_many_sub_managers_are_allowed():
    async def scenario():
        engine = _engine()
        try:
            async with _session(engine) as s:
                ws = UUID(str(await _workshop(s, "W")))
                for i in range(3):
                    person = UUID(str(await _staffer(s, f"Sub {i}")))
                    await workshop_staff_repo.add_staff(
                        s, workshop_id=ws, salesperson_id=person, role="sub", actor_id=None)
                roster = await workshop_staff_repo.list_staff(s, ws)
                assert len([r for r in roster if r["role"] == "sub"]) == 3
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_manager_salesperson_id_is_a_denorm_of_the_roster():
    async def scenario():
        engine = _engine()
        try:
            async with _session(engine) as s:
                ws = UUID(str(await _workshop(s, "W")))
                lead = UUID(str(await _staffer(s, "The lead")))

                await workshop_staff_repo.add_staff(
                    s, workshop_id=ws, salesperson_id=lead, role="lead", actor_id=None)
                row = await workshop_repo.get_workshop(s, ws)
                assert str(row["manager_salesperson_id"]) == str(lead)

                # Retiring the lead clears it back to NULL rather than stranding a
                # stale manager id: recomputed from scratch, not copied from NEW.
                await workshop_staff_repo.deactivate_lead(s, ws)
                row = await workshop_repo.get_workshop(s, ws)
                assert row["manager_salesperson_id"] is None
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_a_sub_manager_counts_as_staff_but_not_as_lead():
    async def scenario():
        engine = _engine()
        try:
            async with _session(engine) as s:
                ws = UUID(str(await _workshop(s, "W")))
                sub = UUID(str(await _staffer(s, "Sub only")))
                await workshop_staff_repo.add_staff(
                    s, workshop_id=ws, salesperson_id=sub, role="sub", actor_id=None)

                assert await workshop_staff_repo.staff_role_at(
                    s, salesperson_id=sub, workshop_id=ws) == "sub"
                caps = stage_flow.capabilities_for(role="workshop_manager", staff_role="sub")
                assert stage_flow.CAP_STATUS in caps
                assert stage_flow.CAP_CUSTODY not in caps
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_one_person_may_staff_two_workshops():
    async def scenario():
        engine = _engine()
        try:
            async with _session(engine) as s:
                ws_a = UUID(str(await _workshop(s, "A")))
                ws_b = UUID(str(await _workshop(s, "B")))
                person = UUID(str(await _staffer(s, "Covers both")))
                await workshop_staff_repo.add_staff(
                    s, workshop_id=ws_a, salesperson_id=person, role="lead", actor_id=None)
                await workshop_staff_repo.add_staff(
                    s, workshop_id=ws_b, salesperson_id=person, role="sub", actor_id=None)
                mine = await workshop_staff_repo.my_workshops(s, person)
                assert {m["staff_role"] for m in mine} == {"lead", "sub"}
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_duplicate_active_membership_is_refused():
    async def scenario():
        engine = _engine()
        try:
            async with _session(engine) as s:
                ws = UUID(str(await _workshop(s, "W")))
                person = UUID(str(await _staffer(s, "Twice")))
                await workshop_staff_repo.add_staff(
                    s, workshop_id=ws, salesperson_id=person, role="sub", actor_id=None)
                with pytest.raises(IntegrityError):
                    await workshop_staff_repo.add_staff(
                        s, workshop_id=ws, salesperson_id=person, role="sub", actor_id=None)
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


# ════════════════════════════════════════════════════════════════════════════
# 4–6 · legs and deadlines
# ════════════════════════════════════════════════════════════════════════════
def test_db_rejects_a_leg_whose_stage_span_runs_backwards():
    async def scenario():
        engine = _engine()
        try:
            async with _session(engine) as s:
                cust = await _customer(s)
                _, (item,) = await _order_with_items(s, cust, 1)
                ws = await _workshop(s, "W")
                with pytest.raises(DBAPIError):
                    await route_repo.insert_leg(
                        s, order_item_id=item, seq=1, workshop_id=ws,
                        stage_from="finishing", stage_to="cutting",
                        planned_days=3, due_at=None)
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_only_one_active_leg_per_item():
    async def scenario():
        engine = _engine()
        try:
            async with _session(engine) as s:
                cust = await _customer(s)
                _, (item,) = await _order_with_items(s, cust, 1)
                ws_a, ws_b = await _workshop(s, "A"), await _workshop(s, "B")
                legs = await _plan_two_leg_route(s, item, ws_a, ws_b)
                with pytest.raises(IntegrityError):
                    await route_repo.set_leg_status(s, legs[1]["id"], "active")
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_due_at_derives_due_date_in_ist():
    async def scenario():
        engine = _engine()
        try:
            async with _session(engine) as s:
                cust = await _customer(s)
                _, (item,) = await _order_with_items(s, cust, 1)
                ws = await _workshop(s, "W")
                # 2026-07-29 20:00 UTC is already 2026-07-30 01:30 IST. A naive
                # ::date cast would store the 29th and the card would show yesterday.
                due_at = datetime(2026, 7, 29, 20, 0, tzinfo=timezone.utc)
                await production_repo.lock_item(s, item)
                alloc = await production_repo.allocate(
                    s, order_item_id=item, workshop_id=UUID(str(ws)), due_date=None,
                    due_at=due_at, actor_id=None)
                assert alloc.due_date.isoformat() == "2026-07-30"
                assert alloc.due_at == due_at
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_legacy_date_only_allocation_still_writes_due_date():
    """The module-08 allocate route passes due_date and no due_at. The trigger must
    leave it alone rather than nulling it."""
    async def scenario():
        engine = _engine()
        try:
            async with _session(engine) as s:
                cust = await _customer(s)
                _, (item,) = await _order_with_items(s, cust, 1)
                ws = await _workshop(s, "W")
                from datetime import date
                due = date(2026, 8, 15)
                await production_repo.lock_item(s, item)
                alloc = await production_repo.allocate(
                    s, order_item_id=item, workshop_id=UUID(str(ws)), due_date=due,
                    actor_id=None)
                assert alloc.due_date == due
                assert alloc.due_at is None
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_route_deadlines_accumulate_across_legs_in_the_db():
    async def scenario():
        engine = _engine()
        try:
            async with _session(engine) as s:
                cust = await _customer(s)
                _, (item,) = await _order_with_items(s, cust, 1)
                ws_a, ws_b = await _workshop(s, "A"), await _workshop(s, "B")
                legs = await _plan_two_leg_route(s, item, ws_a, ws_b)
                first = legs[0]["due_at"].astimezone(IST).date().isoformat()
                second = legs[1]["due_at"].astimezone(IST).date().isoformat()
                assert (first, second) == ("2026-08-01", "2026-08-05")
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


# ════════════════════════════════════════════════════════════════════════════
# 7–11 · handover, receive, cancel
# ════════════════════════════════════════════════════════════════════════════
def test_completing_a_legs_last_stage_then_handover_locks_the_item_in_transit():
    async def scenario():
        engine = _engine()
        try:
            async with _session(engine) as s:
                cust = await _customer(s)
                _, (item,) = await _order_with_items(s, cust, 1)
                ws_a, ws_b = await _workshop(s, "A"), await _workshop(s, "B")
                legs = await _plan_two_leg_route(s, item, ws_a, ws_b)

                # Walk workshop A's span: design_approved … polishing.
                codes = await _stage_codes(s)
                span = codes[codes.index("design_approved"):codes.index("polishing") + 1]
                for code in span:
                    await _tick(s, item, code)

                snap = await _item(s, item)
                # The trigger moved the stage past A's span; the goods have not moved.
                assert snap["current_stage"] == "finishing"
                assert snap["transit_transfer_id"] is None

                transfer = await handover.open_handover(
                    s, order_item_id=item, from_workshop_id=str(ws_a),
                    to_workshop_id=str(ws_b), completed_leg_id=str(legs[0]["id"]),
                    destination_leg_id=str(legs[1]["id"]), due_at=legs[1]["due_at"],
                    actor_id=None)

                snap = await _item(s, item)
                assert str(snap["transit_transfer_id"]) == str(transfer["id"])
                # Custody has NOT moved yet — still workshop A until receive.
                assert str(snap["workshop_id"]) == str(ws_a)
                assert transfer["status"] == "ready"
                assert transfer["transfer_no"].startswith("TRF-")

                after = await route_repo.legs_for_item(s, item)
                assert after[0]["status"] == "completed"
                assert after[1]["status"] == "in_transit"
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_an_item_cannot_be_on_two_open_consignments():
    async def scenario():
        engine = _engine()
        try:
            async with _session(engine) as s:
                cust = await _customer(s)
                _, (item,) = await _order_with_items(s, cust, 1)
                ws_a, ws_b = await _workshop(s, "A"), await _workshop(s, "B")
                legs = await _plan_two_leg_route(s, item, ws_a, ws_b)
                await handover.open_handover(
                    s, order_item_id=item, from_workshop_id=str(ws_a),
                    to_workshop_id=str(ws_b), completed_leg_id=str(legs[0]["id"]),
                    destination_leg_id=str(legs[1]["id"]), due_at=None, actor_id=None)
                with pytest.raises(IntegrityError):
                    await handover.open_handover(
                        s, order_item_id=item, from_workshop_id=str(ws_a),
                        to_workshop_id=str(ws_b), completed_leg_id=None,
                        destination_leg_id=None, due_at=None, actor_id=None)
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_receive_activates_the_next_leg_moves_custody_and_clears_the_lock():
    async def scenario():
        engine = _engine()
        try:
            async with _session(engine) as s:
                cust = await _customer(s)
                _, (item,) = await _order_with_items(s, cust, 1)
                ws_a, ws_b = await _workshop(s, "A"), await _workshop(s, "B")
                legs = await _plan_two_leg_route(s, item, ws_a, ws_b)
                codes = await _stage_codes(s)
                for code in codes[:codes.index("polishing") + 1]:
                    await _tick(s, item, code)
                transfer = await handover.open_handover(
                    s, order_item_id=item, from_workshop_id=str(ws_a),
                    to_workshop_id=str(ws_b), completed_leg_id=str(legs[0]["id"]),
                    destination_leg_id=str(legs[1]["id"]), due_at=legs[1]["due_at"],
                    actor_id=None)

                await transfer_repo.set_status(
                    s, UUID(str(transfer["id"])), "delivered", stamp_column="delivered_at")
                lines = await transfer_repo.lock_transfer_items(s, UUID(str(transfer["id"])))
                locked = await transfer_repo.lock_transfer(s, UUID(str(transfer["id"])))
                results = await handover.receive_transfer(
                    s, transfer=locked, lines=lines, actor_id=None, media_id=None)

                assert len(results) == 1
                snap = await _item(s, item)
                assert str(snap["workshop_id"]) == str(ws_b)     # custody moved
                assert snap["transit_transfer_id"] is None       # lock cleared
                assert snap["current_stage"] == "finishing"      # stage untouched

                after = await route_repo.legs_for_item(s, item)
                assert after[1]["status"] == "active"
                assert after[1]["activated_at"] is not None

                assignments = (await s.execute(text(
                    "select workshop_id, active, due_at from order_item_assignments"
                    " where order_item_id = :i and active = true"),
                    {"i": str(item)})).mappings().all()
                assert len(assignments) == 1
                assert str(assignments[0]["workshop_id"]) == str(ws_b)
                assert assignments[0]["due_at"] == legs[1]["due_at"]
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_the_item_finishes_at_the_second_workshop_and_the_order_goes_ready():
    async def scenario():
        engine = _engine()
        try:
            async with _session(engine) as s:
                cust = await _customer(s)
                oid, (item,) = await _order_with_items(s, cust, 1)
                await s.execute(text("update orders set status='confirmed' where id = :o"),
                                {"o": str(oid)})
                ws_a, ws_b = await _workshop(s, "A"), await _workshop(s, "B")
                legs = await _plan_two_leg_route(s, item, ws_a, ws_b)
                codes = await _stage_codes(s)

                for code in codes[:codes.index("polishing") + 1]:
                    await _tick(s, item, code)
                status = (await s.execute(text("select status from orders where id = :o"),
                                          {"o": str(oid)})).scalar_one()
                assert status == "in_production"

                transfer = await handover.open_handover(
                    s, order_item_id=item, from_workshop_id=str(ws_a),
                    to_workshop_id=str(ws_b), completed_leg_id=str(legs[0]["id"]),
                    destination_leg_id=str(legs[1]["id"]), due_at=None, actor_id=None)
                locked = await transfer_repo.lock_transfer(s, UUID(str(transfer["id"])))
                lines = await transfer_repo.lock_transfer_items(s, UUID(str(transfer["id"])))
                await transfer_repo.set_status(
                    s, UUID(str(transfer["id"])), "delivered", stamp_column="delivered_at")
                locked = await transfer_repo.lock_transfer(s, UUID(str(transfer["id"])))
                await handover.receive_transfer(
                    s, transfer=locked, lines=lines, actor_id=None)

                for code in codes[codes.index("finishing"):]:
                    await _tick(s, item, code)

                snap = await _item(s, item)
                assert snap["production_done_at"] is not None
                assert snap["current_stage"] == "dispatch"
                status = (await s.execute(text("select status from orders where id = :o"),
                                          {"o": str(oid)})).scalar_one()
                assert status == "ready"
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_cancel_reopens_the_origin_leg_and_clears_the_lock():
    async def scenario():
        engine = _engine()
        try:
            async with _session(engine) as s:
                cust = await _customer(s)
                _, (item,) = await _order_with_items(s, cust, 1)
                ws_a, ws_b = await _workshop(s, "A"), await _workshop(s, "B")
                legs = await _plan_two_leg_route(s, item, ws_a, ws_b)
                transfer = await handover.open_handover(
                    s, order_item_id=item, from_workshop_id=str(ws_a),
                    to_workshop_id=str(ws_b), completed_leg_id=str(legs[0]["id"]),
                    destination_leg_id=str(legs[1]["id"]), due_at=None, actor_id=None)

                lines = await transfer_repo.lock_transfer_items(s, UUID(str(transfer["id"])))
                locked = await transfer_repo.lock_transfer(s, UUID(str(transfer["id"])))
                await handover.cancel_transfer(
                    s, transfer=locked, lines=lines, actor_id=None,
                    reason="tempo broke down")

                snap = await _item(s, item)
                assert snap["transit_transfer_id"] is None
                assert str(snap["workshop_id"]) == str(ws_a)
                after = await route_repo.legs_for_item(s, item)
                assert after[0]["status"] == "active"     # origin can keep working
                assert after[1]["status"] == "pending"
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_transfer_events_are_append_only_even_for_the_service_role():
    async def scenario():
        engine = _engine()
        try:
            async with _session(engine) as s:
                ws_a, ws_b = await _workshop(s, "A"), await _workshop(s, "B")
                transfer = await transfer_repo.create_transfer(
                    s, transfer_no=f"TRF-TEST-{uuid4().hex[:6]}",
                    from_workshop_id=ws_a, to_workshop_id=ws_b, reason="next_stage",
                    due_at=None, expected_pickup_at=None, courier_salesperson_id=None,
                    notes=None, actor_id=None)
                event_id = await transfer_repo.insert_event(
                    s, transfer_id=transfer["id"], kind="created", note="first")
                # Each attempt runs in its own SAVEPOINT: a plain rollback() would undo
                # the insert above, the DELETE would then match zero rows, and the test
                # would pass for the wrong reason.
                for sql in (
                    "update workshop_transfer_events set note = 'tampered' where id = :e",
                    "delete from workshop_transfer_events where id = :e",
                ):
                    savepoint = await s.begin_nested()
                    with pytest.raises(DBAPIError):
                        await s.execute(text(sql), {"e": event_id})
                    await savepoint.rollback()
                still_there = (await s.execute(text(
                    "select note from workshop_transfer_events where id = :e"),
                    {"e": event_id})).scalar_one()
                assert still_there == "first"
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_a_consignment_to_the_same_workshop_is_refused_by_the_db():
    async def scenario():
        engine = _engine()
        try:
            async with _session(engine) as s:
                ws = await _workshop(s, "W")
                with pytest.raises(IntegrityError):
                    await transfer_repo.create_transfer(
                        s, transfer_no=f"TRF-SAME-{uuid4().hex[:6]}",
                        from_workshop_id=ws, to_workshop_id=ws, reason="next_stage",
                        due_at=None, expected_pickup_at=None,
                        courier_salesperson_id=None, notes=None, actor_id=None)
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_overdue_scan_ignores_legs_with_no_deadline():
    """The watchdog must not count days against nobody (0024's rule, applied to legs)."""
    async def scenario():
        engine = _engine()
        try:
            async with _session(engine) as s:
                cust = await _customer(s)
                _, (item,) = await _order_with_items(s, cust, 1)
                ws = await _workshop(s, "W")
                leg = await route_repo.insert_leg(
                    s, order_item_id=item, seq=1, workshop_id=ws,
                    stage_from="design_approved", stage_to="dispatch",
                    planned_days=None, due_at=None, status="active")
                overdue = await route_repo.overdue_active_legs(s)
                assert all(str(o["leg_id"]) != str(leg["id"]) for o in overdue)

                # Give it a deadline in the past and it appears.
                await route_repo.set_leg_due_at(
                    s, leg["id"], datetime.now(timezone.utc) - timedelta(days=2))
                overdue = await route_repo.overdue_active_legs(s)
                assert any(str(o["leg_id"]) == str(leg["id"]) for o in overdue)
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_a_finished_item_never_appears_in_the_overdue_scan():
    async def scenario():
        engine = _engine()
        try:
            async with _session(engine) as s:
                cust = await _customer(s)
                _, (item,) = await _order_with_items(s, cust, 1)
                ws = await _workshop(s, "W")
                leg = await route_repo.insert_leg(
                    s, order_item_id=item, seq=1, workshop_id=ws,
                    stage_from="design_approved", stage_to="dispatch",
                    planned_days=1, due_at=datetime.now(timezone.utc) - timedelta(days=3),
                    status="active")
                await s.execute(
                    text("update order_items set production_done_at = now() where id = :i"),
                    {"i": str(item)})
                overdue = await route_repo.overdue_active_legs(s)
                assert all(str(o["leg_id"]) != str(leg["id"]) for o in overdue)
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_queue_for_workshop_returns_no_money_columns():
    """The load-bearing money-blind assertion: this projection is a workshop role's
    ONLY path to production data, and it runs on the service-role connection where RLS
    does not apply."""
    async def scenario():
        engine = _engine()
        try:
            async with _session(engine) as s:
                cust = await _customer(s)
                _, (item,) = await _order_with_items(s, cust, 1)
                ws = await _workshop(s, "W")
                await _plan_two_leg_route(s, item, ws, await _workshop(s, "B"))
                rows = await production_repo.queue_for_workshop(s, [str(ws)])
                assert rows, "the routed item must show up in its workshop's queue"
                forbidden = {"unit_price", "line_total", "gst_rate", "grand_total",
                             "advance_amount", "hsn"}
                assert not (forbidden & set(rows[0].keys()))
                assert rows[0]["leg_total"] == 2
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_transfer_items_projection_returns_no_money_columns():
    """Same assertion for the courier's read — a `delivery` user has no order_items
    policy at all, so this is their entire window onto the goods."""
    async def scenario():
        engine = _engine()
        try:
            async with _session(engine) as s:
                cust = await _customer(s)
                _, (item,) = await _order_with_items(s, cust, 1)
                ws_a, ws_b = await _workshop(s, "A"), await _workshop(s, "B")
                legs = await _plan_two_leg_route(s, item, ws_a, ws_b)
                transfer = await handover.open_handover(
                    s, order_item_id=item, from_workshop_id=str(ws_a),
                    to_workshop_id=str(ws_b), completed_leg_id=str(legs[0]["id"]),
                    destination_leg_id=str(legs[1]["id"]), due_at=None, actor_id=None)
                lines = await transfer_repo.transfer_items(s, UUID(str(transfer["id"])))
                assert len(lines) == 1
                forbidden = {"unit_price", "line_total", "gst_rate", "grand_total"}
                assert not (forbidden & set(lines[0].keys()))
                assert lines[0]["description"] == "Sofa0"
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())
