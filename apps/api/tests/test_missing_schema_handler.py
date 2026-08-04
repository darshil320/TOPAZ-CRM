"""The deployed API can run ahead of its migrations — this is what the caller sees then.

Railway redeploys on push; applying migrations is a separate manual step. In that window a
route whose feature needs a new column answered a bare 500, which the dashboard rendered as
"Request failed (500)" — useless to a showroom owner. These tests pin the translation, and
pin the limit of it: a real SQL bug must keep its 500.
"""
import asyncpg
from fastapi.testclient import TestClient
from sqlalchemy.exc import ProgrammingError
from src.main import create_app, _sqlstate, _MISSING_SCHEMA_SQLSTATES


def _pg_error(sqlstate):
    err = asyncpg.exceptions.PostgresError("boom")
    err.sqlstate = sqlstate
    return ProgrammingError("SELECT 1", {}, err)


def test_sqlstate_extracted_from_asyncpg():
    assert _sqlstate(_pg_error("42703")) == "42703"


def test_missing_column_table_function_are_all_translated():
    assert _MISSING_SCHEMA_SQLSTATES == {"42703", "42P01", "42883"}


def test_handler_returns_503_with_a_readable_detail():
    app = create_app()

    @app.get("/api/_boom_missing")
    async def boom():
        raise _pg_error("42703")

    with TestClient(app, raise_server_exceptions=False) as c:
        r = c.get("/api/_boom_missing")
    assert r.status_code == 503
    assert "migration has not been applied" in r.json()["detail"]


def test_a_real_programming_error_still_500s():
    """A syntax error is a bug — it must not be dressed up as a missing migration."""
    app = create_app()

    @app.get("/api/_boom_syntax")
    async def boom():
        raise _pg_error("42601")   # syntax_error

    with TestClient(app, raise_server_exceptions=False) as c:
        r = c.get("/api/_boom_syntax")
    assert r.status_code == 500
