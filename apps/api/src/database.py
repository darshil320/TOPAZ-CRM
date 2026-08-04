"""Async SQLAlchemy 2.0 engine factory for Supabase Postgres.

Two modes, and the difference is load-bearing:

  - **API engine** (`get_api_session`) — ONE long-lived pooled engine for the
    FastAPI process. Every HTTP route uses this. A pooled connection is reused
    across requests, so a write costs one round-trip set, not a TCP connect +
    TLS handshake + Postgres auth first.
  - **Task engine** (`make_task_session`, NullPool) — a fresh engine per Celery
    task, disposed on exit. Required, not preference: each task runs
    `asyncio.run()` in its own event loop, and an asyncpg connection is bound to
    the loop that opened it — reusing a pooled one across loops corrupts it.

WHY THE SPLIT MATTERS (perf): the API routes used to call `make_task_session()`,
so every dashboard save/update/status change paid a full connect + TLS handshake
to the Supabase pooler (~150-400ms on Railway → ap-south-1) before doing any
work, then threw the connection away. Under concurrency it also opened one
pooler connection per in-flight request, which is how a session-mode pooler runs
out of slots. Routes now share a small pool.

**Never call `get_api_session()` from a Celery task** and never call
`make_task_session()` from a request path.

IMPORTANT: The API engine is created at module import time (thread-safe eager
init). Connections themselves are opened lazily, inside the event loop that
first needs one — which is the server's loop, as required.

Worker pool requirement: Celery workers MUST use --pool=prefork (or solo/threads).
gevent/eventlet monkey-patching breaks asyncio.run() inside tasks.
"""

import ssl
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from .config import get_settings

# Supabase's pooler serves a cert chain rooted at its own private CA
# ("Supabase Root 2021 CA"), not a publicly-trusted root — no public CA
# bundle (system or certifi) will ever verify it. Pinning Supabase's own
# published root CA (downloaded from their dashboard) keeps full
# certificate verification instead of disabling it. A plain SSLContext
# also makes asyncpg skip its default client-cert auto-probe at
# ~/.postgresql/postgresql.{crt,key}, which raises PermissionError
# (instead of a clean "not found") on Railway's sandboxed root filesystem.
_SUPABASE_CA = Path(__file__).parent.parent / "certs" / "supabase-prod-ca-2021.crt"
_SSL_CONTEXT = ssl.create_default_context(cafile=_SUPABASE_CA)


def _make_app_engine():
    """Pooled engine for the API process. Sizing and recycling come from config —
    a session-mode pooler has a finite client-connection budget shared with the
    workers, so this is a deployment fact, not a constant."""
    settings = get_settings()
    connect_args: dict = {"ssl": _SSL_CONTEXT}
    if settings.DB_DISABLE_PREPARED_STATEMENT_CACHE:
        # Required against a TRANSACTION-mode pooler once connections are reused —
        # see the setting's comment in config.py for the failure it prevents.
        connect_args["prepared_statement_cache_size"] = 0
    return create_async_engine(
        settings.DATABASE_URL,
        pool_size=settings.DB_POOL_SIZE,
        max_overflow=settings.DB_MAX_OVERFLOW,
        # Waiting forever for a pooled connection turns a saturated pool into a
        # hung dashboard. Fail fast so the route returns a real error instead.
        pool_timeout=settings.DB_POOL_TIMEOUT_SECONDS,
        # Supabase closes idle connections and the pooler is restarted on their
        # side without notice; both leave a stale socket in the pool that fails
        # the NEXT request. pre_ping + recycle absorb both.
        pool_pre_ping=True,
        pool_recycle=settings.DB_POOL_RECYCLE_SECONDS,
        connect_args=connect_args,
    )


# Eager init at module load — avoids the M-1 check-and-set race under threaded servers.
_app_engine = _make_app_engine()
_app_session_factory = async_sessionmaker(_app_engine, expire_on_commit=False)


@asynccontextmanager
async def get_api_session() -> AsyncGenerator[AsyncSession, None]:
    """Pooled session for a FastAPI request. Use this in every HTTP route.

    Same contract as `make_task_session` (caller commits explicitly; an exception
    rolls back on close), so it is a drop-in swap — only the connection lifetime
    differs.
    """
    async with _app_session_factory() as session:
        yield session


# Historical name kept so nothing that already imported it breaks.
get_session = get_api_session


async def dispose_api_engine() -> None:
    """Close the API pool. Called from the FastAPI shutdown hook so a redeploy
    hands connections back to the pooler instead of leaving them to time out."""
    await _app_engine.dispose()


@asynccontextmanager
async def make_task_session() -> AsyncGenerator[AsyncSession, None]:
    """Context manager yielding a NullPool session for use inside a Celery task.

    Creates a fresh engine per invocation and disposes it on exit (C-1 fix).
    Celery workers run in their own event loops; NullPool ensures no connection
    is shared across event loop boundaries. Requires --pool=prefork/solo/threads.

    NOT for request paths — see the module docstring.
    """
    settings = get_settings()
    engine = create_async_engine(
        settings.DATABASE_URL, poolclass=NullPool, connect_args={"ssl": _SSL_CONTEXT}
    )
    try:
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory() as session:
            yield session
    finally:
        await engine.dispose()
