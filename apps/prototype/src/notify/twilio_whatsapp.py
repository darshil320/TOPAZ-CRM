"""Twilio WhatsApp notifier — the easiest path to *real* WhatsApp for a live demo.

Twilio's WhatsApp sandbox lets you send to numbers that have joined your sandbox
(send the join code once from each phone). No Meta App Review, no template approval —
ideal for the deal-closing demo. For production we move to a BSP (AiSensy); see aisensy.py.

Activates only when the `twilio` package is installed AND creds are present; otherwise
construction raises a clear, actionable error.
"""

from __future__ import annotations

from .base import Alert, Notifier


class TwilioWhatsAppNotifier(Notifier):
    def __init__(
        self,
        account_sid: str,
        auth_token: str,
        from_number: str,
        default_to: str | None = None,
    ) -> None:
        if not account_sid or not auth_token or not from_number:
            raise ValueError(
                "Twilio notifier needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and "
                "TWILIO_WHATSAPP_FROM (e.g. 'whatsapp:+14155238886')."
            )
        try:
            from twilio.rest import Client  # type: ignore
        except ImportError as exc:  # pragma: no cover - env-dependent
            raise ImportError(
                "The 'twilio' package is not installed. Run: pip install twilio"
            ) from exc

        self._client = Client(account_sid, auth_token)
        self._from = self._as_whatsapp(from_number)
        self._default_to = default_to

    @staticmethod
    def _as_whatsapp(number: str) -> str:
        """Twilio expects the 'whatsapp:' scheme prefix on both from/to."""
        number = number.strip()
        return number if number.startswith("whatsapp:") else f"whatsapp:{number}"

    def send(self, alert: Alert) -> None:
        to = alert.to or self._default_to
        if not to:
            raise ValueError("No recipient: set alert.to or TWILIO_WHATSAPP_TO default.")
        kwargs = {
            "from_": self._from,
            "to": self._as_whatsapp(to),
            "body": alert.text,
        }
        # Media requires a publicly reachable URL (see notify.media / src/web.py + ngrok).
        # Without one we send text-only — the alert still lands.
        if alert.media_url:
            kwargs["media_url"] = [alert.media_url]
        self._client.messages.create(**kwargs)
