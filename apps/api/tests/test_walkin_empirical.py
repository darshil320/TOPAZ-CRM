"""Empirical (0052): walk-in assignment + ensure_assigned against a real migrated DB.

Route tests stub these; this proves the SQL itself — assign_primary claims on the
salesperson's behalf and loses cleanly to an earlier claim, and ensure_assigned never
displaces a primary, reactivates an old row instead of duplicating it, and is
idempotent. Run via pgtest.sh.
"""
import asyncio
import os
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from src.repositories import assignment_repo, enrollment_repo, walkin_repo

DB_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="needs TEST_DATABASE_URL (run via pgtest.sh)")


def _async_url() -> str:
    return DB_URL.replace("postgresql://", "postgresql+asyncpg://")


async def _staff(s, wa: str, role: str = "salesperson") -> UUID:
    return (await s.execute(text(
        "insert into salespersons (name, whatsapp, role) values ('S', :wa, :role) returning id"),
        {"wa": wa, "role": role})).scalar_one()


async def _customer(s) -> UUID:
    _, cid = await enrollment_repo.enroll_customer(
        s, name="Walk-in", phone=None, wa_id=None, primary_interest=None,
        face_tracking=False, personal_data=True, whatsapp_marketing=False,
    )
    return cid


async def _assignments(s, cid) -> list[tuple]:
    rows = await s.execute(text(
        "select salesperson_id, role, active from customer_assignments where customer_id = :c"
        " order by role"), {"c": str(cid)})
    return [(str(r[0]), r[1], r[2]) for r in rows.all()]


def _run(scenario):
    async def wrapper():
        engine = create_async_engine(_async_url(), connect_args={"ssl": False})
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                await scenario(s)
                await s.rollback()
        finally:
            await engine.dispose()
    asyncio.run(wrapper())


def test_ensure_assigned_primary_then_collaborator_then_existing():
    async def scenario(s):
        ravi, suresh = await _staff(s, "+910000005211"), await _staff(s, "+910000005212")
        desk = await _staff(s, "+910000005213", "front_desk")
        cid = await _customer(s)

        assert await assignment_repo.ensure_assigned(
            s, customer_id=cid, salesperson_id=ravi, added_by=desk) == "primary"
        assert await assignment_repo.ensure_assigned(
            s, customer_id=cid, salesperson_id=suresh, added_by=desk) == "collaborator"
        assert await assignment_repo.ensure_assigned(
            s, customer_id=cid, salesperson_id=ravi, added_by=desk) == "existing"
        assert set(await _assignments(s, cid)) == {
            (str(suresh), "collaborator", True), (str(ravi), "primary", True)}
    _run(scenario)


def test_ensure_assigned_reactivates_an_old_row_instead_of_duplicating():
    async def scenario(s):
        ravi, suresh = await _staff(s, "+910000005221"), await _staff(s, "+910000005222")
        desk = await _staff(s, "+910000005223", "front_desk")
        cid = await _customer(s)
        await s.execute(text("insert into customer_assignments (customer_id, salesperson_id, role, active)"
                             " values (:c, :r, 'primary', true), (:c, :s, 'collaborator', false)"),
                        {"c": str(cid), "r": str(ravi), "s": str(suresh)})

        assert await assignment_repo.ensure_assigned(
            s, customer_id=cid, salesperson_id=suresh, added_by=desk) == "collaborator"
        assert (str(suresh), "collaborator", True) in await _assignments(s, cid)
        assert len(await _assignments(s, cid)) == 2
    _run(scenario)


def test_get_selling_staff_excludes_inactive_and_non_selling_roles():
    async def scenario(s):
        ravi = await _staff(s, "+910000005231")
        desk = await _staff(s, "+910000005232", "front_desk")
        gone = await _staff(s, "+910000005233")
        await s.execute(text("update salespersons set active = false where id = :i"), {"i": str(gone)})

        assert (await assignment_repo.get_selling_staff(s, ravi))["name"] == "S"
        assert await assignment_repo.get_selling_staff(s, desk) is None
        assert await assignment_repo.get_selling_staff(s, gone) is None
    _run(scenario)


def test_ensure_assigned_missing_customer_is_lookup_error():
    async def scenario(s):
        ravi = await _staff(s, "+910000005261")
        with pytest.raises(LookupError):
            await assignment_repo.ensure_assigned(
                s, customer_id=UUID("00000000-0000-0000-0000-00000000dead"),
                salesperson_id=ravi, added_by=ravi)
    _run(scenario)


def test_walkin_state_reports_withdrawn_consent():
    async def scenario(s):
        cid = await _customer(s)
        assert (await walkin_repo.get_walkin_state(s, cid))["consent_withdrawn"] is False
        await s.execute(text("update consents set withdrawn_at = now() where id ="
                             " (select consent_id from customers where id = :c)"), {"c": str(cid)})
        assert (await walkin_repo.get_walkin_state(s, cid))["consent_withdrawn"] is True
    _run(scenario)


def test_assign_primary_claims_for_the_salesperson_and_loses_to_an_earlier_claim():
    async def scenario(s):
        ravi, suresh = await _staff(s, "+910000005271"), await _staff(s, "+910000005272")
        desk = await _staff(s, "+910000005273", "front_desk")
        cid = await _customer(s)

        assert await walkin_repo.assign_primary(
            s, customer_id=cid, salesperson_id=ravi, assigned_by=desk) is True
        assert (await walkin_repo.get_walkin_state(s, cid))["primary_name"] == "S"
        assert await walkin_repo.assign_primary(
            s, customer_id=cid, salesperson_id=suresh, assigned_by=desk) is False
        assert await _assignments(s, cid) == [(str(ravi), "primary", True)]
    _run(scenario)


def test_assign_primary_reactivates_a_released_salesperson():
    async def scenario(s):
        ravi = await _staff(s, "+910000005281")
        desk = await _staff(s, "+910000005282", "front_desk")
        cid = await _customer(s)
        await s.execute(text("insert into customer_assignments (customer_id, salesperson_id, role, active)"
                             " values (:c, :r, 'collaborator', false)"), {"c": str(cid), "r": str(ravi)})

        assert await walkin_repo.assign_primary(
            s, customer_id=cid, salesperson_id=ravi, assigned_by=desk) is True
        assert await _assignments(s, cid) == [(str(ravi), "primary", True)]
    _run(scenario)


def test_ensure_assigned_refuses_a_customer_who_withdrew_consent():
    async def scenario(s):
        ravi = await _staff(s, "+910000005291")
        cid = await _customer(s)
        await s.execute(text("update consents set withdrawn_at = now() where id ="
                             " (select consent_id from customers where id = :c)"), {"c": str(cid)})
        with pytest.raises(assignment_repo.ConsentWithdrawn):
            await assignment_repo.ensure_assigned(s, customer_id=cid, salesperson_id=ravi, added_by=ravi)
        assert await _assignments(s, cid) == []
    _run(scenario)
