"""AiSensy notifier — the production BSP path (WhatsApp Business Platform).

AiSensy is the chosen BSP for the full build (master plan A4): it gives free in-window
service replies, a native Meta Lead-Ads bridge, and sidesteps Meta App Review.

For proactive owner alerts (business-initiated, often outside the 24h window) AiSensy
sends a pre-approved **template campaign**. This notifier calls the AiSensy campaign API.
The template (e.g. `repeat_customer_alert`) and its parameter order must be approved and
configured in AiSensy first; `templateParams` are positional {{1}}, {{2}}, ... values.

Activates only when an API key is configured; otherwise construction raises.
"""

from __future__ import annotations

from .base import Alert, Notifier

AISENSY_CAMPAIGN_URL = "https://backend.aisensy.com/campaign/t1/api/v2"


class AiSensyNotifier(Notifier):
    def __init__(
        self,
        api_key: str,
        campaign_name: str,
        default_to: str | None = None,
        source_name: str = "Topaz Showroom Intelligence",
    ) -> None:
        if not api_key or not campaign_name:
            raise ValueError(
                "AiSensy notifier needs AISENSY_API_KEY and AISENSY_CAMPAIGN_NAME "
                "(the approved template campaign)."
            )
        try:
            import requests  # type: ignore  # noqa: F401
        except ImportError as exc:  # pragma: no cover - env-dependent
            raise ImportError(
                "The 'requests' package is not installed. Run: pip install requests"
            ) from exc

        self._api_key = api_key
        self._campaign = campaign_name
        self._default_to = default_to
        self._source = source_name

    def send(self, alert: Alert) -> None:
        import requests  # type: ignore

        to = alert.to or self._default_to
        if not to:
            raise ValueError("No recipient: set alert.to or AISENSY_DEFAULT_TO.")

        # AiSensy campaign API: the message body comes from the approved template;
        # `templateParams` fill the {{n}} placeholders. We pass the full rendered text
        # as a single param for the prototype's simple 1-param template.
        payload: dict = {
            "apiKey": self._api_key,
            "campaignName": self._campaign,
            "destination": to.lstrip("+"),
            "userName": self._source,
            "source": self._source,
            "templateParams": [alert.text],
        }
        # If the approved template has an image header, AiSensy accepts a public media URL.
        if alert.media_url:
            payload["media"] = {"url": alert.media_url, "filename": "visitor.jpg"}
        resp = requests.post(AISENSY_CAMPAIGN_URL, json=payload, timeout=15)
        resp.raise_for_status()
