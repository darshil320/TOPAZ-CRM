"""Empirical: server-side authz (module 07 security fix, HIGH-3/HIGH-4).

Proves resolve_caller maps a verified auth uid → salesperson+role, and
assert_can_write_customer enforces the write matrix: owner/admin any customer,
salesperson only assigned, everyone else refused.
"""
import asyncio
import os
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from src.api import authz

DB_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="needs TEST_DATABASE_URL (run via pgtest.sh)")


def _async_url() -> str:
    return DB_URL.replace("postgresql://", "postgresql+asyncpg://")


def run(coro):
    return asyncio.run(coro)


async def _seed(s):
    uids = {r: str(uuid4()) for r in ("owner", "sales", "acct", "other")}
    ids = {}
    for role_key, role in [("owner", "owner"), ("sales", "salesperson"),
                           ("acct", "accounts"), ("other", "salesperson")]:
        rid = (await s.execute(text(
            "insert into salespersons (auth_uid, name, whatsapp, role) "
            "values (:u, :n, :w, :r) returning id"),
            {"u": uids[role_key], "n": role_key, "w": f"+9111{uuid4().hex[:7]}", "r": role})).scalar_one()
        ids[role_key] = str(rid)
    consent = (await s.execute(text(
        "insert into consents (face_tracking, personal_data, whatsapp_marketing, method) "
        "values (true,true,true,'kiosk') returning id"))).scalar_one()
    cust = (await s.execute(text(
        "insert into customers (consent_id, name) values (:c,'C') returning id"),
        {"c": str(consent)})).scalar_one()
    # assign the 'sales' salesperson to the customer
    await s.execute(text(
        "insert into customer_assignments (customer_id, salesperson_id, role, active) "
        "values (:c,:s,'primary',true)"), {"c": str(cust), "s": ids["sales"]})
    return uids, ids, str(cust)


def test_authz_matrix():
    async def scenario():
        engine = create_async_engine(_async_url(), connect_args={"ssl": False})
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                uids, ids, cust = await _seed(s)

                # resolve_caller maps uid -> role
                owner = await authz.resolve_caller(s, uids["owner"])
                assert owner.role == "owner" and owner.salesperson_id == ids["owner"]

                # owner may write any customer
                await authz.assert_can_write_customer(s, owner, cust)

                # assigned salesperson may write; unrelated salesperson may not
                sales = await authz.resolve_caller(s, uids["sales"])
                await authz.assert_can_write_customer(s, sales, cust)
                other = await authz.resolve_caller(s, uids["other"])
                with pytest.raises(HTTPException):
                    await authz.assert_can_write_customer(s, other, cust)

                # accounts is not a quote/order writer
                acct = await authz.resolve_caller(s, uids["acct"])
                with pytest.raises(HTTPException):
                    await authz.assert_can_write_customer(s, acct, cust)

                # unknown uid -> 403
                with pytest.raises(HTTPException):
                    await authz.resolve_caller(s, str(uuid4()))

                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())
