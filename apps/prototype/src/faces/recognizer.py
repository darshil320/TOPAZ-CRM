"""InsightFace/ArcFace wrapper — frame -> detected faces with 512-d embeddings.

This is the only module that pulls heavy ML deps (insightface, onnxruntime, numpy),
so it is imported lazily by callers and is NOT exercised by the pure-logic test suite.
It ports into the Jetson edge pipeline in Phase 1A (master plan E1A-2), where the
ONNX runtime provider switches to CUDA/TensorRT.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DetectedFace:
    """One detected face in a frame.

    bbox:      (x1, y1, x2, y2) ints
    embedding: 512-d L2-normalised ArcFace embedding as a list[float]
    det_score: detector confidence (0..1)
    """

    bbox: tuple[int, int, int, int]
    embedding: list[float]
    det_score: float

    @property
    def area(self) -> int:
        x1, y1, x2, y2 = self.bbox
        return max(0, x2 - x1) * max(0, y2 - y1)


class FaceRecognizer:
    """Thin wrapper over insightface.app.FaceAnalysis.

    Defaults to CPU so the prototype runs on any laptop. Set provider="cuda" on a
    GPU box (or the Jetson) for real-time throughput.
    """

    def __init__(
        self,
        model_name: str = "buffalo_l",
        det_size: tuple[int, int] = (640, 640),
        provider: str = "cpu",
        min_det_score: float = 0.5,
    ) -> None:
        # Imported here (not at module top) so importing the package doesn't require
        # insightface to be installed — keeps the pure-logic tests dependency-free.
        from insightface.app import FaceAnalysis  # type: ignore

        providers = (
            ["CUDAExecutionProvider", "CPUExecutionProvider"]
            if provider.lower() == "cuda"
            else ["CPUExecutionProvider"]
        )
        self._app = FaceAnalysis(name=model_name, providers=providers)
        # ctx_id=0 selects GPU 0 when a CUDA provider is active; harmless on CPU.
        self._app.prepare(ctx_id=0, det_size=det_size)
        self._min_det_score = min_det_score

    def detect(self, frame_bgr) -> list[DetectedFace]:
        """Detect faces in a BGR frame (as read by OpenCV) and return embeddings.

        Faces below `min_det_score` are dropped (blurry/partial detections).
        """
        faces = self._app.get(frame_bgr)
        out: list[DetectedFace] = []
        for f in faces:
            if float(f.det_score) < self._min_det_score:
                continue
            x1, y1, x2, y2 = (int(v) for v in f.bbox)
            # normed_embedding is L2-normalised; fall back to raw embedding if absent.
            emb = getattr(f, "normed_embedding", None)
            if emb is None:
                emb = f.embedding
            out.append(
                DetectedFace(
                    bbox=(x1, y1, x2, y2),
                    embedding=[float(v) for v in emb],
                    det_score=float(f.det_score),
                )
            )
        return out

    def embed_largest(self, frame_bgr) -> DetectedFace | None:
        """Return the largest detected face (used for single-subject enrollment)."""
        faces = self.detect(frame_bgr)
        if not faces:
            return None
        return max(faces, key=lambda f: f.area)
