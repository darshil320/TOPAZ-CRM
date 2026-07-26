"""Celery task: generate a 400px thumbnail for an uploaded media object.

Best-effort by design. If this never succeeds, `media.thumb_key` stays NULL and the
gallery falls back to the full image — a slower tile, not a broken one. That is a
reachable, tested state, not a silent failure.

Pillow is imported INSIDE the task (CLAUDE.md import-light rule) so the pure test
suite still runs on a machine without it.
"""

import asyncio
import io
import logging
from uuid import UUID

from .celery_app import celery_app
from ..config import get_settings
from ..database import make_task_session
from ..repositories import media_repo
from ..services import media_entities, storage

logger = logging.getLogger(__name__)


def _resize(data: bytes, max_edge: int, quality: int) -> bytes:
    """Downscale to fit `max_edge` on the longest side, flatten to RGB JPEG."""
    from PIL import Image

    with Image.open(io.BytesIO(data)) as img:
        img = img.convert("RGB")
        img.thumbnail((max_edge, max_edge))
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=quality, optimize=True)
    return out.getvalue()


async def _make_thumb(media_id: UUID) -> str | None:
    settings = get_settings()
    async with make_task_session() as session:
        row = await media_repo.get_media(session, media_id)
        if row is None:
            logger.error("Media %s not found — cannot thumbnail", media_id)
            return None
        if row["status"] != "ready":
            logger.info("Media %s is %s, not ready — skipping thumbnail", media_id, row["status"])
            return None
        if row["thumb_key"]:
            return str(row["thumb_key"])          # already done; retry-safe

        source = storage.download_bytes(settings.MEDIA_BUCKET, row["storage_key"])
        thumb = await asyncio.to_thread(
            _resize, source, settings.MEDIA_THUMB_EDGE_PX, settings.MEDIA_THUMB_QUALITY
        )
        thumb_key = media_entities.thumb_key_for(row["storage_key"])
        storage.upload_bytes(settings.MEDIA_BUCKET, thumb_key, thumb, "image/jpeg")

        await media_repo.set_thumb_key(session, media_id, thumb_key)
        await session.commit()
    logger.info("Thumbnailed media %s → %s (%d bytes)", media_id, thumb_key, len(thumb))
    return thumb_key


@celery_app.task(bind=True, name="src.tasks.media.make_thumb",
                 max_retries=3, default_retry_delay=15, acks_late=True)
def make_thumb(self, media_id: str) -> str | None:
    try:
        return asyncio.run(_make_thumb(UUID(media_id)))
    except Exception as exc:
        logger.warning("make_thumb failed for %s: %s", media_id, exc)
        raise self.retry(exc=exc)
