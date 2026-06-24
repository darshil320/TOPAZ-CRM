"""pytest fixtures for the RLS suite."""
import pytest

from rls_support import seed_db


@pytest.fixture(scope="session", autouse=True)
def seeded():
    """Seed the known fixture once before the suite runs."""
    seed_db()
    yield
