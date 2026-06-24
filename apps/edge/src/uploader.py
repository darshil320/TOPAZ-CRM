"""Supabase Storage upload for DPDPA-consented face crops.

§19-E: this module MUST NOT be called without a non-None consent_token.
The consent gate is enforced by the caller in main.py — `upload_crop` is a
belt-and-suspenders check.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

import httpx

BUCKET_NAME = "face-crops"
_PATH_UNSAFE = re.compile(r"[^A-Za-z0-9_.-]+")


class CropUploadError(RuntimeError):
    pass


class SupabaseCropUploader:
    """Upload in-memory JPEG face crops to a private Supabase Storage bucket."""

    def __init__(
        self,
        supabase_url: str,
        service_role_key: str,
        *,
        bucket_name: str = BUCKET_NAME,
        timeout_seconds: float = 10.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        if not supabase_url.strip():
            raise ValueError("supabase_url must not be empty")
        if not service_role_key.strip():
            raise ValueError("service_role_key must not be empty")
        self._base = supabase_url.rstrip("/")
        self._key = service_role_key
        self._bucket = bucket_name
        self._client = client or httpx.AsyncClient(timeout=timeout_seconds)
        self._owns_client = client is None

    async def upload_crop(
        self,
        *,
        frame: Any,
        bbox: tuple[int, int, int, int],
        raw_event_id: str,
        camera_id: str,
        captured_at: datetime,
        consent_token: str | None,
    ) -> str | None:
        """Encode bbox crop as JPEG and upload to Storage. Returns photo_key or None.

        §19-E hard gate: returns None immediately if consent_token is absent.
        """
        if consent_token is None:
            return None

        jpeg = _encode_jpeg(frame, bbox)
        if jpeg is None:
            return None

        photo_key = _build_photo_key(camera_id, raw_event_id, captured_at)
        url = f"{self._base}/storage/v1/object/{self._bucket}/{photo_key}"
        response = await self._client.post(
            url,
            content=jpeg,
            headers={
                "Authorization": f"Bearer {self._key}",
                "apikey": self._key,
                "Cache-Control": "3600",
                "Content-Type": "image/jpeg",
                "x-upsert": "false",
            },
        )
        if response.status_code == 409:
            return photo_key  # already uploaded — idempotent
        if not (200 <= response.status_code < 300):
            raise CropUploadError(
                f"Supabase upload failed: status={response.status_code} "
                f"body={response.text[:300]}"
            )
        return photo_key

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()


def _encode_jpeg(frame: Any, bbox: tuple[int, int, int, int]) -> bytes | None:
    import cv2  # type: ignore

    height, width = frame.shape[:2]
    x1, y1, x2, y2 = _clamp(bbox, width, height)
    if x2 <= x1 or y2 <= y1:
        return None
    crop = frame[y1:y2, x1:x2]
    if getattr(crop, "size", 0) == 0:
        return None
    ok, encoded = cv2.imencode(".jpg", crop, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
    if not ok:
        raise CropUploadError("OpenCV could not JPEG-encode face crop")
    return encoded.tobytes()


def _clamp(
    bbox: tuple[int, int, int, int],
    width: int,
    height: int,
) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = bbox
    return (
        max(0, min(width, x1)),
        max(0, min(height, y1)),
        max(0, min(width, x2)),
        max(0, min(height, y2)),
    )


def _build_photo_key(camera_id: str, raw_event_id: str, captured_at: datetime) -> str:
    utc = captured_at.astimezone(timezone.utc)
    return f"{_safe(camera_id)}/{utc.strftime('%Y/%m/%d')}/{_safe(raw_event_id)}.jpg"


def _safe(value: str) -> str:
    cleaned = _PATH_UNSAFE.sub("-", value.strip()).strip(".-")
    if not cleaned:
        raise ValueError(f"cannot build a safe storage path segment from {value!r}")
    return cleaned
