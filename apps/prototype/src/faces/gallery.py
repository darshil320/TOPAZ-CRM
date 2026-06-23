"""Enrolled-face gallery: a JSON-backed store of known customers.

Prototype-only persistence (a JSON file). In Phase 1A this is replaced by
PostgreSQL/pgvector with the consent-first hard gate (master plan E1A-1/E1A-3).
Import-light: depends only on the pure `matching` module + stdlib.
"""

from __future__ import annotations

import json
import os
from collections.abc import Sequence
from dataclasses import asdict, dataclass, field

from .matching import (
    DEFAULT_MATCH_THRESHOLD,
    DEFAULT_NEW_THRESHOLD,
    MatchResult,
    identify,
)


@dataclass(frozen=True)
class Person:
    """One enrolled customer. `interest` is the dummy last-interest shown in alerts."""

    name: str
    interest: str
    embedding: list[float]
    salesperson: str = "Rahul"
    enrolled_at: str = ""


@dataclass(frozen=True)
class Identification:
    """Gallery identification result, resolving the matched Person when known."""

    result: MatchResult
    person: Person | None  # populated only when band == "repeat"


@dataclass
class Gallery:
    """In-memory gallery with JSON load/save. Treat `people` as append-mostly."""

    people: list[Person] = field(default_factory=list)

    # ---- construction / persistence -------------------------------------------------

    @classmethod
    def load(cls, path: str) -> Gallery:
        """Load a gallery from JSON, or return an empty one if the file is absent."""
        if not os.path.exists(path):
            return cls(people=[])
        with open(path, encoding="utf-8") as fh:
            raw = json.load(fh)
        people = [Person(**entry) for entry in raw.get("people", [])]
        return cls(people=people)

    def save(self, path: str) -> None:
        """Persist the gallery to JSON (creates parent dirs as needed)."""
        parent = os.path.dirname(path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        payload = {"people": [asdict(p) for p in self.people]}
        # Write to a temp file then replace, so a crash mid-write can't corrupt the gallery.
        tmp = f"{path}.tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, path)

    # ---- mutation (returns a new Gallery; never mutates in place) --------------------

    def with_person(self, person: Person) -> Gallery:
        """Return a new Gallery with `person` appended (immutable update)."""
        return Gallery(people=[*self.people, person])

    # ---- query ----------------------------------------------------------------------

    def embeddings(self) -> list[list[float]]:
        return [p.embedding for p in self.people]

    def identify(
        self,
        embedding: Sequence[float],
        match_threshold: float = DEFAULT_MATCH_THRESHOLD,
        new_threshold: float = DEFAULT_NEW_THRESHOLD,
    ) -> Identification:
        """Identify a face embedding against the gallery and resolve the Person."""
        result = identify(embedding, self.embeddings(), match_threshold, new_threshold)
        person = (
            self.people[result.index]
            if result.band == "repeat" and result.index is not None
            else None
        )
        return Identification(result=result, person=person)

    def __len__(self) -> int:
        return len(self.people)
