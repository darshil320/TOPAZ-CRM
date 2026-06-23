"""Pure face-matching logic — no InsightFace, NumPy, or OpenCV dependency.

This module is intentionally dependency-free so it can be unit-tested anywhere and
ported verbatim into the Jetson edge classifier in Phase 1A (master plan E1A-2).

Embeddings are plain sequences of floats. With InsightFace `normed_embedding`
(L2-normalised) the cosine similarity reduces to a dot product, but we compute the
full cosine here so the logic is correct for any embedding source.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

# Recognition bands. Tunable at call sites / via config — never hardcode at the
# decision point. Defaults mirror the master plan (A1) and PROTOTYPE_PLAN.md.
DEFAULT_MATCH_THRESHOLD = 0.45  # >= this  -> REPEAT (confident known person)
DEFAULT_NEW_THRESHOLD = 0.30  # <  this  -> NEW
# between the two -> UNCERTAIN (never auto-assert identity)

BAND_REPEAT = "repeat"
BAND_NEW = "new"
BAND_UNCERTAIN = "uncertain"


@dataclass(frozen=True)
class MatchResult:
    """Outcome of identifying one face against a gallery.

    band:      "repeat" | "new" | "uncertain"
    index:     index of the best-matching gallery entry, or None if the gallery is empty
    score:     cosine similarity of the best match (0.0 if gallery empty)
    """

    band: str
    index: int | None
    score: float


def cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    """Cosine similarity of two equal-length vectors. Returns 0.0 for a zero vector."""
    if len(a) != len(b):
        raise ValueError(f"embedding length mismatch: {len(a)} vs {len(b)}")
    dot = 0.0
    norm_a = 0.0
    norm_b = 0.0
    for x, y in zip(a, b, strict=True):  # lengths validated equal above
        dot += x * y
        norm_a += x * x
        norm_b += y * y
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (math.sqrt(norm_a) * math.sqrt(norm_b))


def best_match(
    embedding: Sequence[float],
    gallery: Sequence[Sequence[float]],
) -> tuple[int | None, float]:
    """Return (index, score) of the gallery entry most similar to `embedding`.

    (None, 0.0) when the gallery is empty.
    """
    best_index: int | None = None
    best_score = -1.0
    for i, candidate in enumerate(gallery):
        score = cosine_similarity(embedding, candidate)
        if score > best_score:
            best_score = score
            best_index = i
    if best_index is None:
        return None, 0.0
    return best_index, best_score


def classify(
    score: float,
    match_threshold: float = DEFAULT_MATCH_THRESHOLD,
    new_threshold: float = DEFAULT_NEW_THRESHOLD,
) -> str:
    """Map a best-match score to a band.

    >= match_threshold  -> REPEAT
    <  new_threshold     -> NEW
    otherwise            -> UNCERTAIN
    """
    if match_threshold < new_threshold:
        raise ValueError("match_threshold must be >= new_threshold")
    if score >= match_threshold:
        return BAND_REPEAT
    if score < new_threshold:
        return BAND_NEW
    return BAND_UNCERTAIN


def identify(
    embedding: Sequence[float],
    gallery: Sequence[Sequence[float]],
    match_threshold: float = DEFAULT_MATCH_THRESHOLD,
    new_threshold: float = DEFAULT_NEW_THRESHOLD,
) -> MatchResult:
    """Identify one face embedding against a gallery of embeddings.

    An empty gallery always yields a NEW result (nothing to match against).
    """
    if not gallery:
        return MatchResult(band=BAND_NEW, index=None, score=0.0)
    index, score = best_match(embedding, gallery)
    band = classify(score, match_threshold, new_threshold)
    # If the band came out REPEAT/UNCERTAIN it points at `index`; for NEW the index
    # is irrelevant (the best match was too weak to be this person).
    return MatchResult(band=band, index=index if band != BAND_NEW else None, score=score)
