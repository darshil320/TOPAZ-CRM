"""Async SQLAlchemy 2.0 engine factory for Supabase Postgres.

Two modes:
  - App engine (AsyncSession for FastAPI routes) — long-lived, pooled.
  - Task engine (per-Celery-task, NullPool) — avoids the asyncio event-loop
    mismatch that occurs when an lru_cache'd engine is reused across tasks.
"""

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from .config import get_settings


def _make_app_engine():
    settings = get_settings()
    return create_async_engine(settings.DATABASE_URL, pool_size=5, max_overflow=10)


_app_engine = None
_app_session_factory = None


def get_app_engine():
    global _app_engine, _app_session_factory
    if _app_engine is None:
        _app_engine = _make_app_engine()
        _app_session_factory = async_sessionmaker(_app_engine, expire_on_commit=False)
    return _app_engine, _app_session_factory


@asynccontextmanager
async def get_session() -> AsyncGenerator[AsyncSession, None]:
    _, session_factory = get_app_engine()
    async with session_factory() as session:
        yield session


def make_task_session() -> AsyncSession:
    """Return a fresh NullPool session for use inside a Celery task.

    Celery workers run in their own threads/processes with independent event
    loops; an lru_cache'd engine retains connections tied to a different loop
    and will deadlock. NullPool creates and closes a fresh connection per use.
    """
    settings = get_settings()
    engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    return factory()
