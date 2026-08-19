"""Inline a resolved line photo as a base64 data URI, for document rendering.

WHY A SHARED MODULE. Two documents show the same photo of the same piece of
furniture: the priced quotation the customer receives, and the money-free job card
the workshop receives. The resolution order lives once in
`repositories.job_card_repo.resolve_photo_keys`; the inlining lives once here. A
second copy would eventually disagree — different size cap, different fallback — and
the customer and the workshop would be looking at different pictures of the same sofa.

WHY INLINE AT ALL, rather than passing a URL to the renderer: the media bucket is
private and Playwright has no credentials for it. A template pointing at a private
URL renders a broken image, and `wait_until="networkidle"` stalls waiting for a fetch
that will never succeed — the exact failure this pipeline hit before (STATE.md
2026-07-26, commit 0a43348). The bytes are fetched here, deliberately, before the
browser is involved.

BLOCKING by design: `download_bytes` is sync httpx and both callers are Celery tasks,
which own their thread. Do not call this from a request path.
"""

import base64
import logging

from ..config import get_settings
from .storage import StorageError, download_bytes

logger = logging.getLogger(__name__)

_MIME_BY_EXT = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


def data_uri(key: str, raw: bytes) -> str:
    """`data:<mime>;base64,...` for a storage key's bytes. Pure."""
    ext = key.rsplit(".", 1)[-1].lower()
    mime = _MIME_BY_EXT.get(ext, "image/jpeg")
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"


def inline_photos(items: list[dict], *, document: str = "document") -> list[dict]:
    """Fetch each item's `photo_key` and attach `photo_data_uri`. Returns NEW dicts.

    A photo that cannot be fetched, or is too big to embed, is dropped to None rather
    than raised: one bad image must not cost the customer their quotation or the
    workshop its job card. The template prints "No photo" for that row, and the reason
    is logged with `document` naming which render it was.

    The size cap is not paranoia — the resolver prefers 400px thumbnails but falls back
    to the full original whenever the thumbnail worker hasn't run yet, so without it a
    few un-thumbnailed items can put tens of MB (plus ~33% base64) into worker memory
    and produce a file WhatsApp will refuse.
    """
    settings = get_settings()
    out = []
    for it in items:
        uri = None
        key = it.get("photo_key")
        if key:
            try:
                raw = download_bytes(settings.MEDIA_BUCKET, key)
                if len(raw) > settings.JOB_CARD_MAX_INLINE_BYTES:
                    logger.warning(
                        "%s photo %s is %d bytes (cap %d) — rendering without it",
                        document, key, len(raw), settings.JOB_CARD_MAX_INLINE_BYTES,
                    )
                else:
                    uri = data_uri(key, raw)
            except StorageError as exc:
                logger.warning("%s photo %s unreadable — rendering without it: %s",
                               document, key, exc)
        out.append({**it, "photo_data_uri": uri})
    return out
