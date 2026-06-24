"""Band classification — pure function, zero I/O.

Ported from apps/prototype/src/faces/matching.py and hardened per §19-D.
Thresholds are env-driven; the defaults (0.45/0.30) are synthetic-tuned
and must be re-calibrated from real-camera data (budget one tuning day).
"""

from typing import Literal

MatchBand = Literal["REPEAT", "UNCERTAIN", "NEW"]


def classify_band(
    similarity: float,
    match_threshold: float = 0.45,
    new_threshold: float = 0.30,
) -> MatchBand:
    """Map a cosine similarity score to a recognition band.

    Args:
        similarity: 1 - cosine_distance, range [-1, 1] (L2-normalised: [0, 1]).
        match_threshold: Minimum similarity for a confident REPEAT match.
        new_threshold: Maximum similarity before declaring a truly NEW visitor.

    Returns:
        "REPEAT" if similarity >= match_threshold,
        "NEW"    if similarity < new_threshold,
        "UNCERTAIN" otherwise.
    """
    if similarity >= match_threshold:
        return "REPEAT"
    if similarity < new_threshold:
        return "NEW"
    return "UNCERTAIN"
