"""Async SQLAlchemy 2.0 engine factory for Supabase Postgres.

Two modes:
  - App engine (AsyncSession for FastAPI routes) — long-lived, pooled.
  - Task engine (per-Celery-task, NullPool) — avoids the asyncio event-loop
    mismatch that occurs when an lru_cache'd engine is reused across tasks.

IMPORTANT: The app engine is created at module import time (thread-safe eager
init). Task sessions are context managers that dispose the engine on exit —
never hold a reference across tasks.

Worker pool requirement: Celery workers MUST use --pool=prefork (or solo/threads).
gevent/eventlet monkey-patching breaks asyncio.run() inside tasks.
"""

import ssl
import sys
from contextlib import asynccontextmanager
from typing import AsyncGenerator
from urllib.parse import urlsplit

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from .config import get_settings

# Passed explicitly so asyncpg skips its default client-cert auto-probe at
# ~/.postgresql/postgresql.{crt,key} — that probe raises PermissionError
# (instead of a clean "not found") on Railway's sandboxed root filesystem.
_SSL_CONTEXT = ssl.create_default_context()


def _make_app_engine():
    settings = get_settings()
    parsed = urlsplit(settings.DATABASE_URL)
    print(f"[database] DATABASE_URL host={parsed.hostname} port={parsed.port}", file=sys.stderr, flush=True)
    return create_async_engine(
        settings.DATABASE_URL,
        pool_size=5,
        max_overflow=10,
        connect_args={"ssl": _SSL_CONTEXT},
    )


# Eager init at module load — avoids the M-1 check-and-set race under threaded servers.
_app_engine = _make_app_engine()
_app_session_factory = async_sessionmaker(_app_engine, expire_on_commit=False)


@asynccontextmanager
async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with _app_session_factory() as session:
        yield session


@asynccontextmanager
async def make_task_session() -> AsyncGenerator[AsyncSession, None]:
    """Context manager yielding a NullPool session for use inside a Celery task.

    Creates a fresh engine per invocation and disposes it on exit (C-1 fix).
    Celery workers run in their own event loops; NullPool ensures no connection
    is shared across event loop boundaries. Requires --pool=prefork/solo/threads.
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
