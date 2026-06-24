"""InsightFace buffalo_l detector wrapper for the edge worker.

Imports are lazy (insightface, cv2) so the module can be imported in tests
without ML deps installed — consistent with the prototype convention.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Detection:
    """One detected face in an OpenCV BGR frame."""

    embedding: list[float]  # raw ArcFace 512-d (not yet L2-normalised)
    quality_score: float    # InsightFace det_score, 0..1
    bbox: tuple[int, int, int, int]  # (x1, y1, x2, y2) pixel coords

    @property
    def area(self) -> int:
        x1, y1, x2, y2 = self.bbox
        return max(0, x2 - x1) * max(0, y2 - y1)


class FaceDetector:
    """Thin wrapper over insightface.app.FaceAnalysis(name="buffalo_l").

    Defaults to CPUExecutionProvider so the edge worker runs on any x86 mini-PC.
    Pass providers=["CUDAExecutionProvider", "CPUExecutionProvider"] for Jetson GPU.
    """

    def __init__(
        self,
        model_name: str = "buffalo_l",
        det_size: tuple[int, int] = (640, 640),
        providers: list[str] | None = None,
    ) -> None:
        from insightface.app import FaceAnalysis  # type: ignore

        runtime_providers = providers or ["CPUExecutionProvider"]
        self._app = FaceAnalysis(name=model_name, providers=runtime_providers)
        self._app.prepare(ctx_id=0, det_size=det_size)

    def detect(self, frame: Any) -> list[Detection]:
        """Return all faces detected in a BGR frame with their ArcFace embeddings."""
        detections: list[Detection] = []
        for face in self._app.get(frame):
            embedding = _extract_embedding(face)
            if embedding is None:
                continue
            detections.append(
                Detection(
                    embedding=embedding,
                    quality_score=float(getattr(face, "det_score", 0.0)),
                    bbox=_extract_bbox(face),
                )
            )
        return detections


def _extract_embedding(face: Any) -> list[float] | None:
    # normed_embedding is L2-normalised by InsightFace; prefer it when available.
    raw = getattr(face, "normed_embedding", None)
    if raw is None:
        raw = getattr(face, "embedding", None)
    if raw is None:
        return None
    return [float(v) for v in raw]


def _extract_bbox(face: Any) -> tuple[int, int, int, int]:
    raw = getattr(face, "bbox", None)
    if raw is None:
        raise ValueError("InsightFace detection missing bbox")
    x1, y1, x2, y2 = (int(v) for v in raw)
    return (x1, y1, x2, y2)
