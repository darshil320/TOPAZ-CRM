"""Console notifier — prints the alert. Always works, no credentials.

Use this to verify the end-to-end flow before wiring real WhatsApp, and as the
default so the demo never hard-fails on missing creds.
"""

from __future__ import annotations

from .base import Alert, Notifier

_RESET = "\033[0m"
_BOLD = "\033[1m"
_GREEN = "\033[32m"
_YELLOW = "\033[33m"


class ConsoleNotifier(Notifier):
    """Prints a framed alert to stdout. `use_color` off for clean test capture."""

    def __init__(self, use_color: bool = True) -> None:
        self._use_color = use_color

    def _c(self, text: str, color: str) -> str:
        if not self._use_color:
            return text
        return f"{color}{text}{_RESET}"

    def send(self, alert: Alert) -> None:
        color = _GREEN if alert.kind == "repeat" else _YELLOW
        header = self._c(f"── WhatsApp alert [{alert.kind}] ──", _BOLD)
        print(header)
        print(self._c(alert.text, color))
        if alert.to:
            print(f"  → to: {alert.to}")
        if alert.media_url:
            print(f"  → media: {alert.media_url}")
        elif alert.photo_path:
            print(f"  → photo (local, not public): {alert.photo_path}")
        print()
