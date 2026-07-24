"""Supabase Storage helpers — private-bucket upload + signed URL.

Uses the service-role key server-side only (never reaches the browser). PDFs
live in a PRIVATE bucket; customer links are short-lived signed URLs. All calls
raise StorageError on failure so callers (Celery tasks) can retry.
"""

import logging

import httpx

from ..config import get_settings

logger = logging.getLogger(__name__)


class StorageError(RuntimeError):
    """Raised when Storage is unconfigured or the API returns a non-2xx."""


def _base_and_headers() -> tuple[str, dict]:
    settings = get_settings()
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
        raise StorageError("Supabase Storage not configured (SUPABASE_URL / SERVICE_ROLE_KEY)")
    base = f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1"
    headers = {
        "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
        "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
    }
    return base, headers


def upload_bytes(bucket: str, key: str, data: bytes, content_type: str = "application/pdf") -> str:
    """Upload (upsert) bytes to bucket/key. Returns the storage key. Raises StorageError."""
    base, headers = _base_and_headers()
    url = f"{base}/object/{bucket}/{key}"
    try:
        resp = httpx.post(
            url,
            content=data,
            headers={**headers, "Content-Type": content_type, "x-upsert": "true"},
            timeout=30,
        )
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise StorageError(f"Upload to {bucket}/{key} failed: {exc}") from exc
    logger.info("Uploaded %d bytes to %s/%s", len(data), bucket, key)
    return key


def signed_url(bucket: str, key: str, expires_in: int = 3600) -> str:
    """Create a short-lived signed URL for a private object. Raises StorageError."""
    base, headers = _base_and_headers()
    settings = get_settings()
    url = f"{base}/object/sign/{bucket}/{key}"
    try:
        resp = httpx.post(url, json={"expiresIn": expires_in}, headers=headers, timeout=15)
        resp.raise_for_status()
        signed = resp.json().get("signedURL") or resp.json().get("signedUrl")
    except httpx.HTTPError as exc:
        raise StorageError(f"Sign {bucket}/{key} failed: {exc}") from exc
    if not signed:
        raise StorageError(f"Sign {bucket}/{key} returned no URL")
    # The signed path is relative to the storage root.
    return f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1{signed}"
