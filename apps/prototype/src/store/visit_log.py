"""Append-only visit log (JSONL). Prototype stand-in for the `visits` table (PRD §8).

Append-only mirrors the production rule: visit history is never destructively
overwritten (master plan NFR-12). One JSON object per line.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class Visit:
    """One recorded door event."""

    occurred_at: str  # ISO timestamp
    band: str  # "new" | "repeat" | "uncertain"
    name: str | None  # known customer name, or None for new/uncertain
    interest: str | None
    score: float  # best-match cosine score
    photo_path: str | None  # captured face crop, for new visitors


class VisitLog:
    """Appends visits to a JSONL file and reads them back."""

    def __init__(self, path: str) -> None:
        self._path = path

    def append(self, visit: Visit) -> None:
        parent = os.path.dirname(self._path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(self._path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(asdict(visit), ensure_ascii=False) + "\n")

    def recent(self, limit: int = 20) -> list[Visit]:
        """Return the most recent visits (newest last), up to `limit`."""
        if not os.path.exists(self._path):
            return []
        with open(self._path, encoding="utf-8") as fh:
            lines = [ln for ln in fh.read().splitlines() if ln.strip()]
        visits = [Visit(**json.loads(ln)) for ln in lines]
        return visits[-limit:]

    def count(self) -> int:
        if not os.path.exists(self._path):
            return 0
        with open(self._path, encoding="utf-8") as fh:
            return sum(1 for ln in fh if ln.strip())
