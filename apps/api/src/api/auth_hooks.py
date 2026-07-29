"""Supabase Auth Hooks — currently just Send SMS (module 14 follow-up).

    POST /api/auth/send-sms-hook

Called directly by Supabase's GoTrue server whenever a phone-OTP login is
requested (i.e. exactly what `apps/dashboard/src/app/login/page.tsx` already
triggers via `supabase.auth.signInWithOtp({ phone })` — that call is UNCHANGED).
Supabase generates and verifies the OTP and mints the session itself; this hook's
only job is DELIVERY, which it does over the same Meta WhatsApp Cloud API already
live in this codebase instead of a new SMS vendor (see services/auth_otp.py for why).

AUTH IS DELIBERATELY NOT `Depends(require_dashboard_key)`. Every other router in
this API is called by our own dashboard/edge worker, which can carry our
pre-shared `DASHBOARD_API_KEY`/`EDGE_API_KEY`. Supabase's infrastructure calls
THIS endpoint directly and signs it with the Standard Webhooks scheme instead
(https://www.standardwebhooks.com/) — verified below via
services/webhook_signing.py, matching the same hand-rolled-HMAC precedent as the
Meta `X-Hub-Signature-256` check on `/api/whatsapp/webhook`.

FAILS CLOSED: an unsigned or wrongly-signed request is rejected before the body is
even parsed as JSON — this endpoint sends a WhatsApp message on Supabase's say-so,
so an unverified caller must never reach that far.
"""

import asyncio
import json
import logging

from fastapi import APIRouter, HTTPException, Request, status

from ..config import get_settings
from ..services.auth_otp import InvalidOtpError, otp_params
from ..services.webhook_signing import WebhookVerificationError, verify_standard_webhook

logger = logging.getLogger(__name__)
router = APIRouter()


def _hook_error(http_code: int, message: str) -> dict:
    """Supabase Auth Hooks' documented error shape — surfaced to the end user's
    login attempt as a real error instead of a generic failure, so "template not
    approved yet" reads as that, not as a silent hang."""
    return {"error": {"http_code": http_code, "message": message}}


@router.post("/auth/send-sms-hook")
async def send_sms_hook(request: Request) -> dict:
    settings = get_settings()
    if not settings.SUPABASE_SEND_SMS_HOOK_SECRET:
        # Fail closed, matching the Meta webhook's own rule when WA_APP_SECRET is
        # unset (CLAUDE.md: never trust an unverifiable request over trusting none).
        logger.error("send-sms-hook called but SUPABASE_SEND_SMS_HOOK_SECRET is unset")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="Send SMS hook is not configured")

    body = await request.body()
    try:
        verify_standard_webhook(
            secret=settings.SUPABASE_SEND_SMS_HOOK_SECRET,
            webhook_id=request.headers.get("webhook-id", ""),
            webhook_timestamp=request.headers.get("webhook-timestamp", ""),
            body=body,
            signature_header=request.headers.get("webhook-signature", ""),
        )
    except WebhookVerificationError as exc:
        logger.warning("send-sms-hook signature rejected: %s", exc)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Invalid webhook signature") from exc

    try:
        payload = json.loads(body)
        phone = payload["user"]["phone"]
        code = payload["sms"]["otp"]
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        logger.error("send-sms-hook payload missing user.phone/sms.otp: %s", exc)
        return _hook_error(400, "Malformed hook payload")

    try:
        params = otp_params(code)
    except InvalidOtpError as exc:
        logger.error("send-sms-hook: %s", exc)
        return _hook_error(400, "Malformed OTP code")

    to = phone if phone.startswith("+") else f"+{phone}"

    from ..tasks.whatsapp import send_wa_template

    try:
        # In-request, NOT enqueued via Celery: Supabase is waiting on this HTTP
        # response to know whether the login code actually went out. A `.delay()`
        # here would report success before delivery was ever attempted.
        # `send_wa_template` is a blocking call (httpx sync) — off the event loop
        # via to_thread, same pattern as tasks/production_notify.py's `_send_template`.
        # button_params=params (reusing the same OTP value): confirmed empirically
        # that this template's "Copy code" option compiles to a URL-type button
        # Meta requires a matching component for — see send_wa_template's docstring.
        wamid = await asyncio.to_thread(
            send_wa_template, to, settings.WA_OTP_TEMPLATE_NAME, params,
            settings.WA_OTP_TEMPLATE_LANG, params,
        )
    except Exception as exc:  # noqa: BLE001 — surfaced to Supabase as a hook error, not a 500
        logger.error("send-sms-hook: WhatsApp send failed for %s: %s", to, exc)
        return _hook_error(500, "Could not send the login code — please try again")

    if wamid is None:
        logger.error("send-sms-hook: WhatsApp send returned no message id for %s", to)
        return _hook_error(500, "Could not send the login code — please try again")

    logger.info("send-sms-hook: OTP delivered to %s via WhatsApp (wamid=%s)", to, wamid)
    return {}
