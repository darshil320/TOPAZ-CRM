"""§19-E consent token resolution for the edge worker.

Three modes (CONSENT_MODE env):
  kiosk — poll GET /api/enrollment/pending; a non-null token means a customer
          just registered at the kiosk and is awaiting face capture. Polls are
          throttled to consent_poll_seconds; the last value is served between
          polls so per-frame resolution stays cheap.
  open  — return a static test token for every detection (bench testing only;
          the API still validates the token, so nothing enrolls unless it is a
          real consent UUID).
  off   — return None for every detection (strict §19-E: all detections drop).
"""

from __future__ import annotations

import logging
import time

import httpx

LOGGER = logging.getLogger(__name__)

OPEN_MODE_TOKEN = "test-consent-open"


class ConsentResolver:
    def __init__(
        self,
        *,
        mode: str,
        api_url: str,
        api_key: str,
        poll_seconds: float = 2.0,
        timeout_seconds: float = 5.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        if mode not in ("kiosk", "open", "off"):
            raise ValueError(f"invalid consent mode: {mode!r}")
        self._mode = mode
        self._endpoint = _pending_endpoint(api_url)
        self._api_key = api_key
        self._poll_seconds = poll_seconds
        self._client = client or httpx.AsyncClient(timeout=timeout_seconds)
        self._owns_client = client is None
        self._cached_token: str | None = None
        self._last_poll_at: float = 0.0

    @property
    def mode(self) -> str:
        return self._mode

    async def resolve(self) -> str | None:
        """Token to attach to the current detection, or None (drop)."""
        if self._mode == "off":
            return None
        if self._mode == "open":
            return OPEN_MODE_TOKEN
        return await self._poll_kiosk()

    async def _poll_kiosk(self) -> str | None:
        now = time.monotonic()
        if now - self._last_poll_at < self._poll_seconds:
            return self._cached_token
        self._last_poll_at = now

        try:
            response = await self._client.get(
                self._endpoint, headers={"API-Key": self._api_key}
            )
            response.raise_for_status()
            token = response.json().get("consent_token")
            self._cached_token = token if isinstance(token, str) and token else None
        except (httpx.HTTPError, ValueError):
            LOGGER.warning("consent poll failed; dropping detections this window", exc_info=True)
            self._cached_token = None
        return self._cached_token

    def invalidate(self) -> None:
        """Forget the cached token (call after it has been attached once)."""
        self._cached_token = None

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()


def _pending_endpoint(api_url: str) -> str:
    base = api_url.strip().rstrip("/")
    if base.endswith("/api"):
        return f"{base}/enrollment/pending"
    return f"{base}/api/enrollment/pending"
