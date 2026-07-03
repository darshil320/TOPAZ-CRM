"""Shared pytest fixtures.

The DB seed is opt-in (usefixtures in test_rls.py) so pure unit tests run
without a live Supabase instance.
"""
import pytest


@pytest.fixture(scope="session")
def seeded():
    """Seed the known RLS fixture once before the DB-backed suite runs."""
    from rls_support import seed_db

    seed_db()
    yield
