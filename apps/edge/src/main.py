"""Topaz Layer 2 showroom edge worker — main loop.

Pipeline (§6.1):
  ThreadedVideoCapture → FaceDetector (InsightFace buffalo_l) →
  quality gate → §19-E consent gate → CooldownTracker →
  L2-normalise (numpy) → SupabaseCropUploader (consent-gated) →
  RecognitionPoster (POST /api/recognition, 3 retries)

SIGINT / SIGTERM → graceful shutdown (camera + HTTP clients released).
"""

from __future__ import annotations

import asyncio
import logging
import signal
import threading
import time
from collections.abc import Sequence
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from .config import Settings, load_settings
from .cooldown import CooldownTracker
from .detector import Detection, FaceDetector
from .poster import RecognitionEvent, RecognitionPostError, RecognitionPoster
from .uploader import CropUploadError, SupabaseCropUploader

LOGGER = logging.getLogger(__name__)


class ThreadedVideoCapture:
    """OpenCV VideoCapture that reads in a daemon thread, keeping only the latest frame.

    The main async loop calls `read()` at frame_poll_seconds intervals; stale frames
    are discarded automatically. This prevents the async event loop from blocking on
    cap.read() I/O.
    """

    def __init__(self, source: int | str) -> None:
        self._source = source
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._frame: Any | None = None
        self._cap: Any | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> ThreadedVideoCapture:
        import cv2  # type: ignore

        self._cap = cv2.VideoCapture(self._source)
        if not self._cap.isOpened():
            raise RuntimeError(f"could not open camera source {self._source!r}")
        self._thread = threading.Thread(
            target=self._read_loop, name="camera-reader", daemon=True
        )
        self._thread.start()
        return self

    def read(self) -> Any | None:
        with self._lock:
            return None if self._frame is None else self._frame.copy()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
        if self._cap is not None:
            self._cap.release()

    def _read_loop(self) -> None:
        assert self._cap is not None
        while not self._stop.is_set():
            ok, frame = self._cap.read()
            if not ok:
                LOGGER.warning("camera read failed; retrying")
                time.sleep(0.25)
                continue
            with self._lock:
                self._frame = frame


async def run() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    settings = load_settings()

    # §19-E: Layer 3 consent seam not yet wired — every detection is dropped.
    # This warning is intentional and must remain until the kiosk integration ships.
    LOGGER.warning(
        "§19-E: Layer 3 consent seam not wired — detections are dropped "
        "until the kiosk consent token is available"
    )

    poster = RecognitionPoster(
        settings.api_url,
        settings.api_key_value,
        timeout_seconds=settings.request_timeout_seconds,
    )
    uploader: SupabaseCropUploader | None = None
    capture: ThreadedVideoCapture | None = None

    try:
        detector = FaceDetector()
        cooldown = CooldownTracker(settings.cooldown_seconds)
        capture = ThreadedVideoCapture(settings.camera_source).start()
        stop_event = asyncio.Event()
        _install_signal_handlers(stop_event)
        LOGGER.info(
            "edge worker started camera_id=%s source=%r",
            settings.camera_id,
            settings.camera_source,
        )

        while not stop_event.is_set():
            frame = capture.read()
            if frame is None:
                await asyncio.sleep(settings.frame_poll_seconds)
                continue
            try:
                uploader = await _process_frame(
                    frame, detector, cooldown, poster, uploader, settings
                )
            except Exception:
                LOGGER.exception("frame processing error (continuing)")
            await asyncio.sleep(settings.frame_poll_seconds)
    finally:
        if capture is not None:
            capture.stop()
        if uploader is not None:
            await uploader.close()
        await poster.close()

    LOGGER.info("edge worker stopped")
    return 0


async def _process_frame(
    frame: Any,
    detector: FaceDetector,
    cooldown: CooldownTracker,
    poster: RecognitionPoster,
    uploader: SupabaseCropUploader | None,
    settings: Settings,
) -> SupabaseCropUploader | None:
    detections = detector.detect(frame)
    for detection in detections:
        uploader = await _handle_detection(
            frame, detection, cooldown, poster, uploader, settings
        )
    return uploader


async def _handle_detection(
    frame: Any,
    detection: Detection,
    cooldown: CooldownTracker,
    poster: RecognitionPoster,
    uploader: SupabaseCropUploader | None,
    settings: Settings,
) -> SupabaseCropUploader | None:
    # 1. Quality gate (cheap in-process filter first)
    if detection.quality_score < settings.quality_floor:
        return uploader

    # 2. §19-E DPDPA consent gate — LAYER 3 SEAM
    # Replace _resolve_consent_token with a call to the kiosk consent service.
    consent_token = _resolve_consent_token(detection)
    if consent_token is None:
        return uploader  # no consent → drop; no embedding, crop, or event stored

    # 3. Cooldown: suppress same-face re-fire within the cooldown window
    try:
        if cooldown.should_suppress(detection.embedding):
            return uploader
        normalised_embedding = _l2_normalise(detection.embedding)
    except ValueError:
        LOGGER.exception("invalid embedding; dropping detection")
        return uploader

    raw_event_id = str(uuid4())
    captured_at = datetime.now(timezone.utc)
    photo_key: str | None = None

    # 4. Upload crop (only when consent is present — SupabaseCropUploader also checks)
    if uploader is None:
        uploader = _build_uploader(settings)
    try:
        photo_key = await uploader.upload_crop(
            frame=frame,
            bbox=detection.bbox,
            raw_event_id=raw_event_id,
            camera_id=settings.camera_id,
            captured_at=captured_at,
            consent_token=consent_token,
        )
    except CropUploadError:
        LOGGER.exception(
            "crop upload failed raw_event_id=%s; posting without photo_key", raw_event_id
        )

    # 5. POST recognition event to the API
    event = RecognitionEvent(
        raw_event_id=raw_event_id,
        embedding=normalised_embedding,
        quality_score=detection.quality_score,
        camera_id=settings.camera_id,
        captured_at=_iso_z(captured_at),
        photo_key=photo_key,
    )
    try:
        await poster.post_event(event)
        LOGGER.info(
            "posted recognition event raw_event_id=%s quality=%.3f",
            raw_event_id,
            detection.quality_score,
        )
    except RecognitionPostError:
        LOGGER.exception("POST failed raw_event_id=%s", raw_event_id)

    return uploader


def _resolve_consent_token(_detection: Detection) -> str | None:
    """§19-E Layer 3 seam. Returns None until the kiosk consent service is wired."""
    return None


def _build_uploader(settings: Settings) -> SupabaseCropUploader:
    key = settings.supabase_service_role_key_value
    if settings.supabase_url is None or key is None:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for crop uploads"
        )
    return SupabaseCropUploader(
        settings.supabase_url,
        key,
        timeout_seconds=settings.request_timeout_seconds,
    )


def _l2_normalise(embedding: Sequence[float]) -> list[float]:
    import numpy as np

    vector = np.asarray(embedding, dtype=np.float64)
    if vector.ndim != 1 or vector.size == 0:
        raise ValueError("embedding must be a non-empty 1-D vector")
    if not np.all(np.isfinite(vector)):
        raise ValueError("embedding contains a non-finite value")
    norm = float(np.linalg.norm(vector))
    if norm == 0.0 or not np.isfinite(norm):
        raise ValueError("embedding must not be the zero vector")
    return (vector / norm).tolist()


def _iso_z(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _install_signal_handlers(stop_event: asyncio.Event) -> None:
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop_event.set)
        except (NotImplementedError, RuntimeError):
            # Windows / Jetson edge cases — fall back to stdlib signal handler
            signal.signal(sig, lambda _s, _f: loop.call_soon_threadsafe(stop_event.set))


def main() -> int:
    return asyncio.run(run())


if __name__ == "__main__":
    raise SystemExit(main())
