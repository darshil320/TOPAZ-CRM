"""Supabase Storage helpers — private-bucket upload + signed URL.

Uses the service-role key server-side only (never reaches the browser). PDFs
live in a PRIVATE bucket; customer links are short-lived signed URLs. All calls
raise StorageError on failure so callers (Celery tasks) can retry.

**Two flavours of every read helper, and the choice is not stylistic:**

  - the plain `signed_url(...)` / `object_size(...)` functions are BLOCKING
    (`httpx.post`). Correct inside a Celery task, which owns its thread.
  - `signed_url_async(...)` / `signed_urls_async(...)` / `object_size_async(...)`
    are for FastAPI routes. A blocking httpx call inside an `async def` route
    stalls the whole event loop for the duration of the round-trip to Supabase —
    with a private bucket that is one HTTPS call per image, so a photo gallery
    used to freeze every other in-flight request while it signed.

`signed_urls_async` also signs MANY keys in one request (Storage's batch sign
endpoint), which is what turns an N-photo gallery from N round-trips into one.

The async helpers share one `httpx.AsyncClient`, so signing reuses an already
established TLS connection to the Storage host. `aclose()` is called from the
app's shutdown hook.
"""

import asyncio
import logging

import httpx

from ..config import get_settings

logger = logging.getLogger(__name__)


class StorageError(RuntimeError):
    """Raised when Storage is unconfigured or the API returns a non-2xx."""


# ─── Shared async client ─────────────────────────────────────────────────────
# Created lazily on first use so importing this module needs no event loop, and
# guarded by a lock so two concurrent first-requests cannot build two clients.
_async_client: httpx.AsyncClient | None = None
_async_client_lock = asyncio.Lock()

# Signing is a small JSON round-trip; a request that has not answered in this long
# is not going to. Kept short on purpose — a route that hangs is worse than one
# that reports "could not generate the image link".
_ASYNC_TIMEOUT_SECONDS = 15.0


async def _client() -> httpx.AsyncClient:
    global _async_client
    if _async_client is None or _async_client.is_closed:
        async with _async_client_lock:
            if _async_client is None or _async_client.is_closed:
                _async_client = httpx.AsyncClient(
                    timeout=_ASYNC_TIMEOUT_SECONDS,
                    # Enough to cover the pooled DB connections that can be signing
                    # concurrently, without holding sockets open forever.
                    limits=httpx.Limits(max_keepalive_connections=10, max_connections=20),
                )
    return _async_client


async def aclose() -> None:
    """Close the shared client. Idempotent — safe to call on a process that never
    signed anything."""
    global _async_client
    if _async_client is not None and not _async_client.is_closed:
        await _async_client.aclose()
    _async_client = None


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


def object_size(bucket: str, key: str) -> int | None:
    """Actual byte size of a stored object, or None if it is not there.

    The size must come from Storage, never from the client: the browser PUTs
    straight to a signed URL, so a self-reported byte count at /complete is just a
    claim. Raises StorageError only when Storage is unconfigured/unreachable — a
    clean 404 returns None.
    """
    base, headers = _base_and_headers()
    url = f"{base}/object/info/{bucket}/{key}"
    try:
        resp = httpx.get(url, headers=headers, timeout=15)
    except httpx.HTTPError as exc:
        raise StorageError(f"Stat {bucket}/{key} failed: {exc}") from exc
    if resp.status_code == 404:
        return None
    if resp.status_code >= 400:
        raise StorageError(f"Stat {bucket}/{key} failed: HTTP {resp.status_code}")
    try:
        body = resp.json()
    except ValueError as exc:
        raise StorageError(f"Stat {bucket}/{key} returned a non-JSON body") from exc
    # Supabase has moved this field between top level and `metadata` across
    # versions; accept either rather than silently reporting 0 bytes.
    raw = body.get("size")
    if raw is None and isinstance(body.get("metadata"), dict):
        raw = body["metadata"].get("size")
    if raw is None:
        raise StorageError(f"Stat {bucket}/{key} returned no size")
    return int(raw)


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
    """Create a short-lived signed URL for a private object. Raises StorageError.

    BLOCKING — for Celery tasks. Request paths must use `signed_url_async`.
    """
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


# ─── Async variants (FastAPI routes) ─────────────────────────────────────────


def _absolute(signed_path: str) -> str:
    """Storage returns the signed path relative to the storage root."""
    settings = get_settings()
    return f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1{signed_path}"


async def signed_url_async(bucket: str, key: str, expires_in: int = 3600) -> str:
    """Non-blocking `signed_url`. Raises StorageError."""
    base, headers = _base_and_headers()
    client = await _client()
    try:
        resp = await client.post(
            f"{base}/object/sign/{bucket}/{key}", json={"expiresIn": expires_in}, headers=headers
        )
        resp.raise_for_status()
        body = resp.json()
    except httpx.HTTPError as exc:
        raise StorageError(f"Sign {bucket}/{key} failed: {exc}") from exc
    except ValueError as exc:
        raise StorageError(f"Sign {bucket}/{key} returned a non-JSON body") from exc
    signed = body.get("signedURL") or body.get("signedUrl")
    if not signed:
        raise StorageError(f"Sign {bucket}/{key} returned no URL")
    return _absolute(signed)


async def signed_urls_async(
    bucket: str, keys: list[str], expires_in: int = 3600
) -> dict[str, str]:
    """Sign MANY keys in ONE round-trip. Returns {key: absolute_url}.

    This is the whole point of the batch endpoint: a gallery or a line-item table
    signs every image at once instead of paying one HTTPS round-trip per tile.

    PARTIAL SUCCESS IS THE CONTRACT: Storage reports per-path errors inside a 200
    body, and a key that failed is simply absent from the returned map. The caller
    renders a placeholder for that one image rather than losing the page — one
    stale storage key must not blank out nineteen good photos. A transport-level
    failure (whole request) still raises StorageError.

    Duplicate keys are collapsed before signing, so a catalog photo shared by five
    lines is signed once.
    """
    unique = list(dict.fromkeys(k for k in keys if k))
    if not unique:
        return {}

    base, headers = _base_and_headers()
    client = await _client()
    try:
        resp = await client.post(
            f"{base}/object/sign/{bucket}",
            json={"expiresIn": expires_in, "paths": unique},
            headers=headers,
        )
        resp.raise_for_status()
        rows = resp.json()
    except httpx.HTTPError as exc:
        raise StorageError(f"Batch sign of {len(unique)} object(s) in {bucket} failed: {exc}") from exc
    except ValueError as exc:
        raise StorageError(f"Batch sign in {bucket} returned a non-JSON body") from exc

    if not isinstance(rows, list):
        raise StorageError(f"Batch sign in {bucket} returned {type(rows).__name__}, expected a list")

    out: dict[str, str] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        path = row.get("path")
        signed = row.get("signedURL") or row.get("signedUrl")
        if not path or not signed:
            logger.warning("Batch sign skipped %s in %s: %s", path, bucket, row.get("error"))
            continue
        out[str(path)] = _absolute(str(signed))
    return out


async def object_size_async(bucket: str, key: str) -> int | None:
    """Non-blocking `object_size`. None when the object is not there."""
    base, headers = _base_and_headers()
    client = await _client()
    try:
        resp = await client.get(f"{base}/object/info/{bucket}/{key}", headers=headers)
    except httpx.HTTPError as exc:
        raise StorageError(f"Stat {bucket}/{key} failed: {exc}") from exc
    if resp.status_code == 404:
        return None
    if resp.status_code >= 400:
        raise StorageError(f"Stat {bucket}/{key} failed: HTTP {resp.status_code}")
    try:
        body = resp.json()
    except ValueError as exc:
        raise StorageError(f"Stat {bucket}/{key} returned a non-JSON body") from exc
    raw = body.get("size")
    if raw is None and isinstance(body.get("metadata"), dict):
        raw = body["metadata"].get("size")
    if raw is None:
        raise StorageError(f"Stat {bucket}/{key} returned no size")
    return int(raw)


async def signed_upload_url_async(bucket: str, key: str, expires_in: int = 900) -> str:
    """Non-blocking `signed_upload_url`. Raises StorageError."""
    base, headers = _base_and_headers()
    client = await _client()
    try:
        resp = await client.post(
            f"{base}/object/upload/sign/{bucket}/{key}",
            json={"expiresIn": expires_in},
            headers=headers,
        )
        resp.raise_for_status()
        body = resp.json()
    except httpx.HTTPError as exc:
        raise StorageError(f"Sign upload {bucket}/{key} failed: {exc}") from exc
    except ValueError as exc:
        raise StorageError(f"Sign upload {bucket}/{key} returned a non-JSON body") from exc
    signed = body.get("url") or body.get("signedURL") or body.get("signedUrl")
    if not signed:
        raise StorageError(f"Sign upload {bucket}/{key} returned no URL")
    return _absolute(str(signed))
