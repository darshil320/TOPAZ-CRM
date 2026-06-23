"""Prototype configuration — read from environment (.env), with safe defaults.

Nothing here is hardcoded at a decision point: thresholds, paths, recipient, the active
notifier, the public base URL (for media), and the web port are all overridable.
`build_notifier()` is the single factory that turns config into a concrete Notifier,
importing heavy SDKs lazily.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from .faces.matching import DEFAULT_MATCH_THRESHOLD, DEFAULT_NEW_THRESHOLD
from .notify.base import Notifier

# Paths are relative to apps/prototype/ (the dir you run commands from).
DEFAULT_GALLERY_PATH = "data/gallery.json"
DEFAULT_VISITS_PATH = "data/visits.jsonl"
DEFAULT_CAPTURES_DIR = "data/captures"


def _load_dotenv() -> None:
    """Load .env if python-dotenv is available; silently skip if not."""
    try:
        from dotenv import load_dotenv  # type: ignore

        load_dotenv()
    except ImportError:
        pass


def _get_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class Config:
    # recognition
    match_threshold: float = DEFAULT_MATCH_THRESHOLD
    new_threshold: float = DEFAULT_NEW_THRESHOLD
    alert_cooldown_seconds: float = 120.0
    model_name: str = "buffalo_l"
    provider: str = "cpu"  # "cpu" | "cuda"
    camera_index: int = 0

    # storage
    gallery_path: str = DEFAULT_GALLERY_PATH
    visits_path: str = DEFAULT_VISITS_PATH
    captures_dir: str = DEFAULT_CAPTURES_DIR

    # notifier
    notifier: str = "console"  # "console" | "twilio" | "aisensy"
    owner_whatsapp: str | None = None  # default alert recipient (E.164)
    showroom_name: str = "Topaz"

    # media + web view
    public_base_url: str | None = None  # e.g. https://abc.ngrok.io — enables photo media
    web_port: int = 8077

    @classmethod
    def from_env(cls) -> Config:
        _load_dotenv()
        return cls(
            match_threshold=_get_float("MATCH_THRESHOLD", DEFAULT_MATCH_THRESHOLD),
            new_threshold=_get_float("NEW_THRESHOLD", DEFAULT_NEW_THRESHOLD),
            alert_cooldown_seconds=_get_float("ALERT_COOLDOWN_SECONDS", 120.0),
            model_name=os.getenv("MODEL_NAME", "buffalo_l"),
            provider=os.getenv("PROVIDER", "cpu"),
            camera_index=int(_get_float("CAMERA_INDEX", 0)),
            gallery_path=os.getenv("GALLERY_PATH", DEFAULT_GALLERY_PATH),
            visits_path=os.getenv("VISITS_PATH", DEFAULT_VISITS_PATH),
            captures_dir=os.getenv("CAPTURES_DIR", DEFAULT_CAPTURES_DIR),
            notifier=os.getenv("NOTIFIER", "console").lower(),
            owner_whatsapp=os.getenv("OWNER_WHATSAPP") or None,
            showroom_name=os.getenv("SHOWROOM_NAME", "Topaz"),
            public_base_url=os.getenv("PUBLIC_BASE_URL") or None,
            web_port=int(_get_float("WEB_PORT", 8077)),
        )


def build_notifier(config: Config) -> Notifier:
    """Construct the configured notifier. Heavy SDKs imported lazily inside each branch."""
    kind = config.notifier
    if kind == "console":
        from .notify.console import ConsoleNotifier

        return ConsoleNotifier()
    if kind == "twilio":
        from .notify.twilio_whatsapp import TwilioWhatsAppNotifier

        return TwilioWhatsAppNotifier(
            account_sid=os.getenv("TWILIO_ACCOUNT_SID", ""),
            auth_token=os.getenv("TWILIO_AUTH_TOKEN", ""),
            from_number=os.getenv("TWILIO_WHATSAPP_FROM", ""),
            default_to=config.owner_whatsapp,
        )
    if kind == "aisensy":
        from .notify.aisensy import AiSensyNotifier

        return AiSensyNotifier(
            api_key=os.getenv("AISENSY_API_KEY", ""),
            campaign_name=os.getenv("AISENSY_CAMPAIGN_NAME", ""),
            default_to=config.owner_whatsapp,
        )
    raise ValueError(f"Unknown NOTIFIER '{kind}'. Use console | twilio | aisensy.")
