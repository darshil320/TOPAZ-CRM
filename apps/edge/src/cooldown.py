"""In-memory same-face cooldown using cosine similarity.

Pure module — no heavy deps. Thread-safe: main loop runs async but the
threaded VideoCapture reader does not touch this class.
"""

from __future__ import annotations

import math
import time
from collections.abc import Sequence
from dataclasses import dataclass
from threading import RLock

DEFAULT_COSINE_THRESHOLD = 0.80  # same-face threshold; higher than server's 0.45


@dataclass(frozen=True)
class _Slot:
    embedding: tuple[float, ...]
    last_seen_at: float


class CooldownTracker:
    """Suppress repeated event fires for the same estimated physical face.

    When `should_suppress(embedding)` returns True, the caller drops the event.
    A non-suppressed embedding is recorded; a suppressed one refreshes its slot
    timestamp so a person standing in frame cannot re-fire every 30 seconds.
    Expired slots are pruned on each call.
    """

    def __init__(
        self,
        cooldown_seconds: float,
        cosine_threshold: float = DEFAULT_COSINE_THRESHOLD,
    ) -> None:
        if cooldown_seconds <= 0:
            raise ValueError("cooldown_seconds must be > 0")
        if not 0.0 <= cosine_threshold <= 1.0:
            raise ValueError("cosine_threshold must be between 0 and 1")
        self._cooldown_seconds = cooldown_seconds
        self._cosine_threshold = cosine_threshold
        self._slots: list[_Slot] = []
        self._lock = RLock()

    def should_suppress(self, embedding: Sequence[float], now: float | None = None) -> bool:
        seen_at = time.monotonic() if now is None else now
        normalised = _l2_normalise(embedding)

        with self._lock:
            self._prune_expired(seen_at)
            for index, slot in enumerate(self._slots):
                if _dot(normalised, slot.embedding) >= self._cosine_threshold:
                    self._slots[index] = _Slot(embedding=normalised, last_seen_at=seen_at)
                    return True
            self._slots.append(_Slot(embedding=normalised, last_seen_at=seen_at))
            return False

    def prune_expired(self, now: float | None = None) -> None:
        seen_at = time.monotonic() if now is None else now
        with self._lock:
            self._prune_expired(seen_at)

    def _prune_expired(self, now: float) -> None:
        self._slots = [s for s in self._slots if (now - s.last_seen_at) < self._cooldown_seconds]


def _l2_normalise(embedding: Sequence[float]) -> tuple[float, ...]:
    if not embedding:
        raise ValueError("embedding must not be empty")
    values = tuple(float(v) for v in embedding)
    for v in values:
        if not math.isfinite(v):
            raise ValueError("embedding contains a non-finite value")
    norm_sq = sum(v * v for v in values)
    if norm_sq == 0.0:
        raise ValueError("embedding must not be the zero vector")
    norm = math.sqrt(norm_sq)
    return tuple(v / norm for v in values)


def _dot(a: Sequence[float], b: Sequence[float]) -> float:
    if len(a) != len(b):
        raise ValueError(f"embedding length mismatch: {len(a)} vs {len(b)}")
    return sum(x * y for x, y in zip(a, b, strict=True))
