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


def signed_upload_url(bucket: str, key: str, expires_in: int = 900) -> str:
    """Create a short-lived signed UPLOAD url so the browser can PUT bytes straight
    into a private bucket without ever holding the service-role key.

    Returns the absolute URL (token embedded). The browser PUTs the file body to it.
    Raises StorageError.
    """
    base, headers = _base_and_headers()
    settings = get_settings()
    url = f"{base}/object/upload/sign/{bucket}/{key}"
    try:
        resp = httpx.post(url, json={"expiresIn": expires_in}, headers=headers, timeout=15)
        resp.raise_for_status()
        body = resp.json()
        signed = body.get("url") or body.get("signedURL") or body.get("signedUrl")
    except httpx.HTTPError as exc:
        raise StorageError(f"Sign upload {bucket}/{key} failed: {exc}") from exc
    if not signed:
        raise StorageError(f"Sign upload {bucket}/{key} returned no URL")
    # The signed path is relative to the storage root.
    return f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1{signed}"


def object_exists(bucket: str, key: str) -> bool:
    """True if the object is really present. Used by /media/{id}/complete so a
    client that never finished its upload cannot mark a row 'ready' (a phantom row
    renders as a broken tile forever). Raises StorageError only when Storage is
    unconfigured/unreachable — a clean 404 returns False."""
    base, headers = _base_and_headers()
    url = f"{base}/object/info/{bucket}/{key}"
    try:
        resp = httpx.get(url, headers=headers, timeout=15)
    except httpx.HTTPError as exc:
        raise StorageError(f"Stat {bucket}/{key} failed: {exc}") from exc
    if resp.status_code == 404:
        return False
    if resp.status_code >= 400:
        raise StorageError(f"Stat {bucket}/{key} failed: HTTP {resp.status_code}")
    return True


def download_bytes(bucket: str, key: str) -> bytes:
    """Fetch a private object's bytes server-side (thumbnail generation). Raises StorageError."""
    base, headers = _base_and_headers()
    url = f"{base}/object/{bucket}/{key}"
    try:
        resp = httpx.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise StorageError(f"Download {bucket}/{key} failed: {exc}") from exc
    return resp.content


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
