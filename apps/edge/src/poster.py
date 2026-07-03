"""Async POST of recognition events to the FastAPI backend with retry.

Three attempts, exponential back-off (0.25s, 0.5s). Idempotency is handled
server-side via raw_event_id; the Idempotency-Key header is forwarded as a hint.
"""

from __future__ import annotations

import asyncio
import math
from dataclasses import dataclass, field
from typing import Any

import httpx

MAX_ATTEMPTS = 3
INITIAL_BACKOFF = 0.25  # seconds

# Codes worth retrying: transient server errors and rate limits.
# 409 is intentionally excluded — our API never returns 409 for recognition events,
# and retrying on 409 could mask a genuine misconfiguration.
RETRYABLE_STATUS_CODES = {408, 425, 429, 500, 502, 503, 504}


class RecognitionPostError(RuntimeError):
    pass


@dataclass(frozen=True)
class RecognitionEvent:
    """Payload for POST /api/recognition. Embedding must be L2-normalised."""

    raw_event_id: str
    embedding: list[float]
    quality_score: float
    camera_id: str
    captured_at: str  # ISO 8601 with Z suffix
    photo_key: str | None = field(default=None)
    consent_token: str | None = field(default=None)

    def to_payload(self) -> dict[str, Any]:
        if not self.raw_event_id:
            raise ValueError("raw_event_id must not be empty")
        if not self.camera_id:
            raise ValueError("camera_id must not be empty")
        if not self.embedding:
            raise ValueError("embedding must not be empty")
        if any(not math.isfinite(v) for v in self.embedding):
            raise ValueError("embedding contains a non-finite value")
        norm = math.sqrt(sum(v * v for v in self.embedding))
        if abs(norm - 1.0) > 1e-3:
            raise ValueError("embedding must be L2-normalised before POST")
        if not math.isfinite(self.quality_score):
            raise ValueError("quality_score must be finite")
        return {
            "raw_event_id": self.raw_event_id,
            "embedding": self.embedding,
            "quality_score": self.quality_score,
            "photo_key": self.photo_key,
            "camera_id": self.camera_id,
            "captured_at": self.captured_at,
            "consent_token": self.consent_token,
        }


class RecognitionPoster:
    def __init__(
        self,
        api_url: str,
        api_key: str,
        *,
        timeout_seconds: float = 10.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        if not api_url.strip():
            raise ValueError("api_url must not be empty")
        if not api_key.strip():
            raise ValueError("api_key must not be empty")
        self._endpoint = _recognition_endpoint(api_url)
        self._api_key = api_key
        self._client = client or httpx.AsyncClient(timeout=timeout_seconds)
        self._owns_client = client is None

    async def post_event(self, event: RecognitionEvent) -> None:
        payload = event.to_payload()
        headers = {
            "API-Key": self._api_key,
            "Idempotency-Key": event.raw_event_id,
        }
        last_error: BaseException | None = None

        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                response = await self._client.post(
                    self._endpoint, json=payload, headers=headers
                )
                if response.status_code in RETRYABLE_STATUS_CODES and attempt < MAX_ATTEMPTS:
                    await asyncio.sleep(INITIAL_BACKOFF * (2 ** (attempt - 1)))
                    continue
                if not (200 <= response.status_code < 300):
                    raise RecognitionPostError(
                        f"recognition POST failed: status={response.status_code} "
                        f"body={response.text[:300]}"
                    )
                return
            except httpx.RequestError as exc:
                last_error = exc
                if attempt < MAX_ATTEMPTS:
                    await asyncio.sleep(INITIAL_BACKOFF * (2 ** (attempt - 1)))

        raise RecognitionPostError(
            f"recognition POST failed after {MAX_ATTEMPTS} attempts: {last_error!r}"
        )

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()


def _recognition_endpoint(api_url: str) -> str:
    base = api_url.strip().rstrip("/")
    # Support both https://host/api and https://host as base URL formats.
    if base.endswith("/api"):
        return f"{base}/recognition"
    return f"{base}/api/recognition"
