"""Notifier interface + the Alert value object.

One interface, swappable implementations (console / Twilio / AiSensy). In Phase 1A/1B
this same abstraction becomes the WhatsApp BSP send layer and is hardened into the
24-hour-window chokepoint (master plan E1A-4 / E1B-1).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

KIND_NEW = "new"
KIND_REPEAT = "repeat"


@dataclass(frozen=True)
class Alert:
    """A WhatsApp owner-alert to be delivered.

    kind:       "new" | "repeat"
    text:       fully rendered message body
    to:         destination WhatsApp number in E.164 (e.g. +9196...), or None to use the
                notifier's configured default recipient
    photo_path: local path to the captured face photo (new-customer alerts), if any
    media_url:  publicly reachable URL of the photo, if available. WhatsApp/Twilio can
                only attach media from a public URL — see notify.media.public_url_for and
                the web view (src/web.py) which serves captures so they can be exposed.
    """

    kind: str
    text: str
    to: str | None = None
    photo_path: str | None = None
    media_url: str | None = None


class Notifier(ABC):
    """Delivers an Alert. Implementations must be safe to call repeatedly."""

    @abstractmethod
    def send(self, alert: Alert) -> None:  # pragma: no cover - interface
        ...
