"""Login-OTP delivery via WhatsApp (Supabase Send SMS Hook → this codebase's existing
Meta Cloud API integration, instead of a new SMS/Twilio vendor).

WHY THIS EXISTS: Supabase's phone-OTP login needs an SMS provider (Twilio et al.), and
sending OTP/transactional SMS to Indian numbers additionally requires DLT registration
with an Indian telecom regulator — real money, real paperwork, real delay. This system
already has an approved, working Meta WhatsApp Business API integration
(`tasks/whatsapp.py`) with real templates live in production. Supabase's Send SMS Hook
(https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook) lets a custom HTTPS
endpoint take over OTP DELIVERY only — Supabase still generates the code, verifies it,
and mints the session exactly as before, so `signInWithOtp`/`verifyOtp` on the client
need ZERO changes (see `apps/dashboard/src/app/login/page.tsx`).

WHY POSITIONAL PARAMS, NOT NAMED (unlike every other template send in this codebase —
see services/templates.py, services/transit_messages.py): Meta's AUTHENTICATION
template category is a distinct kind of template from Utility/Marketing. Its body text
is Meta-generated at creation time (you cannot type free body copy — WhatsApp Manager's
Authentication flow only lets you choose options like "add an expiry line" or "add a
security-recommendation line"), and it takes its one variable — the code — as a plain
positional body parameter with no `parameter_name`.
"""

OTP_LENGTH = 6


class InvalidOtpError(ValueError):
    """The value Supabase's hook payload calls the OTP does not look like one — never
    silently sent as-is. See services/webhook_signing.py's module docstring for the
    matching principle on the signature side: fail closed, not silently permissive."""


def otp_params(code: str) -> list[dict]:
    """Meta Cloud API positional body-parameter list for an Authentication-category
    template send. Raises InvalidOtpError rather than forwarding a malformed value —
    Supabase's own Send SMS Hook payload spec guarantees `sms.otp` matches
    `^[0-9]{6}$`, so anything else reaching here means the hook contract changed
    upstream and this integration needs a look, not a best-effort send.
    """
    if not code.isdigit() or len(code) != OTP_LENGTH:
        raise InvalidOtpError(f"OTP '{code}' is not a {OTP_LENGTH}-digit numeric code")
    return [{"type": "text", "text": code}]
