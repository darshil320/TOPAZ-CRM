"""Live demo loop — the deal-closer.

Opens the webcam, recognises faces, and fires a WhatsApp owner-alert on each
new/repeat visitor (with a per-person cooldown so it doesn't spam). New-visitor alerts
attach the captured photo when a public base URL is configured (see notify.media).
Draws the recognition label on screen.

Controls:
    q   quit
    e   enroll the largest face on screen (prompts for name + interest in the terminal)

Run:
    python -m src.demo
"""

from __future__ import annotations

import os
import time
from datetime import datetime

from .config import Config, build_notifier
from .faces.gallery import Gallery, Person
from .faces.matching import BAND_NEW, BAND_REPEAT, BAND_UNCERTAIN
from .faces.recognizer import DetectedFace, FaceRecognizer
from .notify.base import KIND_NEW, KIND_REPEAT, Alert
from .notify.media import public_url_for
from .notify.messages import new_customer_message, repeat_customer_message
from .store.visit_log import Visit, VisitLog


def _now_human() -> str:
    return datetime.now().strftime("%d %b %Y, %I:%M %p")


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


class CooldownTracker:
    """Suppresses repeat alerts for the same identity within a cooldown window."""

    def __init__(self, cooldown_seconds: float) -> None:
        self._cooldown = cooldown_seconds
        self._last: dict[str, float] = {}

    def should_alert(self, key: str, now: float) -> bool:
        last = self._last.get(key)
        if last is not None and (now - last) < self._cooldown:
            return False
        self._last[key] = now
        return True


def _save_capture(frame, face: DetectedFace, captures_dir: str) -> str | None:
    """Save a crop of the detected face for new-customer alerts. Returns the path."""
    import cv2  # type: ignore

    os.makedirs(captures_dir, exist_ok=True)
    x1, y1, x2, y2 = face.bbox
    crop = frame[max(0, y1) : max(0, y2), max(0, x1) : max(0, x2)]
    if crop.size == 0:
        return None
    path = os.path.join(captures_dir, f"{datetime.now().strftime('%Y%m%d_%H%M%S')}.jpg")
    cv2.imwrite(path, crop)
    return path


def _draw(frame, face: DetectedFace, label: str, color: tuple[int, int, int]) -> None:
    import cv2  # type: ignore

    x1, y1, x2, y2 = face.bbox
    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
    cv2.putText(
        frame,
        label,
        (x1, max(0, y1 - 10)),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.6,
        color,
        2,
        cv2.LINE_AA,
    )


def run() -> int:
    import cv2  # type: ignore

    config = Config.from_env()
    recognizer = FaceRecognizer(model_name=config.model_name, provider=config.provider)
    notifier = build_notifier(config)
    visit_log = VisitLog(config.visits_path)
    gallery = Gallery.load(config.gallery_path)
    cooldown = CooldownTracker(config.alert_cooldown_seconds)

    media_state = "public URL set" if config.public_base_url else "text-only (no PUBLIC_BASE_URL)"
    print(
        f"Loaded {len(gallery)} enrolled people · notifier={config.notifier} · "
        f"thresholds match={config.match_threshold} new={config.new_threshold} · photos: {media_state}"
    )
    print("Controls: [q] quit  [e] enroll largest face")

    cap = cv2.VideoCapture(config.camera_index)
    if not cap.isOpened():
        print(f"Could not open camera index {config.camera_index}.")
        return 1

    # Colours (BGR): repeat=green, new=amber, uncertain=grey.
    colors = {BAND_REPEAT: (0, 180, 0), BAND_NEW: (0, 170, 255), BAND_UNCERTAIN: (150, 150, 150)}

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                print("Camera read failed.")
                break

            faces = recognizer.detect(frame)
            largest: DetectedFace | None = None
            for face in faces:
                if largest is None or face.area > largest.area:
                    largest = face

                ident = gallery.identify(
                    face.embedding, config.match_threshold, config.new_threshold
                )
                band = ident.result.band
                score = ident.result.score
                now = time.time()

                if band == BAND_REPEAT and ident.person is not None:
                    label = f"{ident.person.name} ({score:.2f})"
                    if cooldown.should_alert(f"repeat:{ident.person.name}", now):
                        text = repeat_customer_message(
                            ident.person.name,
                            ident.person.interest,
                            _now_human(),
                            ident.person.salesperson,
                        )
                        notifier.send(Alert(kind=KIND_REPEAT, text=text, to=config.owner_whatsapp))
                        visit_log.append(
                            Visit(
                                occurred_at=_now_iso(),
                                band=band,
                                name=ident.person.name,
                                interest=ident.person.interest,
                                score=score,
                                photo_path=None,
                            )
                        )
                elif band == BAND_NEW:
                    label = f"New visitor ({score:.2f})"
                    # Unknowns have no stable identity key, so gate on a short global
                    # cooldown so one walk-in fires one alert.
                    if cooldown.should_alert("new:_global", now):
                        photo = _save_capture(frame, face, config.captures_dir)
                        text = new_customer_message(_now_human(), config.showroom_name)
                        notifier.send(
                            Alert(
                                kind=KIND_NEW,
                                text=text,
                                to=config.owner_whatsapp,
                                photo_path=photo,
                                media_url=public_url_for(photo, config.public_base_url),
                            )
                        )
                        visit_log.append(
                            Visit(
                                occurred_at=_now_iso(),
                                band=band,
                                name=None,
                                interest=None,
                                score=score,
                                photo_path=photo,
                            )
                        )
                else:  # uncertain — never auto-assert; in production routes to staff confirm
                    label = f"Uncertain ({score:.2f})"

                _draw(frame, face, label, colors.get(band, (200, 200, 200)))

            cv2.imshow("Topaz Showroom Intelligence — live demo", frame)
            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                break
            if key == ord("e") and largest is not None:
                name = input("Enroll — name: ").strip() or "Guest"
                interest = input("Enroll — last interest: ").strip() or "furniture"
                gallery = gallery.with_person(
                    Person(
                        name=name,
                        interest=interest,
                        embedding=largest.embedding,
                        enrolled_at=_now_iso(),
                    )
                )
                gallery.save(config.gallery_path)
                print(f"Enrolled '{name}'. Gallery now has {len(gallery)} people.")
    finally:
        cap.release()
        cv2.destroyAllWindows()

    print(f"Session ended. Total visits logged: {visit_log.count()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
