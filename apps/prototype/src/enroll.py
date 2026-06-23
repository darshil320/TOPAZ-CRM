"""Enroll a face into the gallery — from an image file or a webcam snapshot.

Examples:
    python -m src.enroll --image samples/hemant.jpg --name "Hemant" --interest "7-seater sofa"
    python -m src.enroll --webcam --name "Hemant" --interest "7-seater sofa"

For the live demo you can also enroll on the spot by pressing 'e' inside `python -m src.demo`.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime

from .config import Config
from .faces.gallery import Gallery, Person
from .faces.recognizer import FaceRecognizer


def _capture_from_webcam(camera_index: int):
    """Grab a single frame from the webcam. Imports cv2 lazily."""
    import cv2  # type: ignore

    cap = cv2.VideoCapture(camera_index)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open camera index {camera_index}.")
    print("Look at the camera — SPACE to capture, ESC to cancel.")
    frame = None
    try:
        while True:
            ok, f = cap.read()
            if not ok:
                raise RuntimeError("Failed to read from camera.")
            cv2.imshow("Enroll — SPACE to capture, ESC to cancel", f)
            key = cv2.waitKey(1) & 0xFF
            if key == 32:  # SPACE
                frame = f
                break
            if key == 27:  # ESC
                break
    finally:
        cap.release()
        cv2.destroyAllWindows()
    return frame


def _load_image(path: str):
    import cv2  # type: ignore

    frame = cv2.imread(path)
    if frame is None:
        raise RuntimeError(f"Could not read image: {path}")
    return frame


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Enroll a face into the Topaz gallery.")
    parser.add_argument("--name", required=True, help="Customer name (shown in alerts).")
    parser.add_argument(
        "--interest", default="furniture", help="Last interest, e.g. '7-seater sofa'."
    )
    parser.add_argument("--salesperson", default="Rahul", help="Handling salesperson.")
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--image", help="Path to a face image to enroll.")
    src.add_argument("--webcam", action="store_true", help="Capture from the webcam.")
    args = parser.parse_args(argv)

    config = Config.from_env()
    recognizer = FaceRecognizer(model_name=config.model_name, provider=config.provider)

    frame = _capture_from_webcam(config.camera_index) if args.webcam else _load_image(args.image)
    if frame is None:
        print("Enrollment cancelled — no frame captured.", file=sys.stderr)
        return 1

    face = recognizer.embed_largest(frame)
    if face is None:
        print("No face detected. Try better lighting / a clearer frontal photo.", file=sys.stderr)
        return 2

    gallery = Gallery.load(config.gallery_path)
    person = Person(
        name=args.name,
        interest=args.interest,
        embedding=face.embedding,
        salesperson=args.salesperson,
        enrolled_at=datetime.now().isoformat(timespec="seconds"),
    )
    gallery = gallery.with_person(person)
    gallery.save(config.gallery_path)
    print(
        f"Enrolled '{args.name}' (interest: {args.interest}, "
        f"det_score={face.det_score:.2f}). Gallery now has {len(gallery)} people."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
