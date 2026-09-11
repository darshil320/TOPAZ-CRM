"""Pure rules for lead call-note recordings.

Scoped to one entity (a lead) on purpose. `media_entities.py` is a polymorphic
registry spanning five tables and a 30-way entity_type x kind cross-product; audio
recordings only ever attach to a `lead`, so there is nothing to whitelist beyond the
mime allowlist and the key layout below. This module is deliberately smaller.

`lead_recordings` is a separate table + bucket from `media` (see 0048's header):
`media.mime`'s CHECK excludes audio and `media.entity_type`'s CHECK excludes 'lead',
and widening either would drag this feature into `media`'s DPDPA consent-gating
branch, which does not apply here — a lead has no consent record pre-conversion.

No I/O, no DB, no heavy imports — unit-tested by tests/test_lead_audio.py.
"""

from uuid import UUID

# Upload mime -> file extension. Also the allowlist: an unmapped mime is rejected.
# Covers Chrome/Android MediaRecorder's default (webm), iOS voice-memo exports (mp4,
# reported as audio/mp4 not audio/m4a), and common phone-recorder exports (mpeg=mp3,
# wav). ogg covers Firefox/some Android recorders.
#
# mp4 -> m4a deliberately: "m4a" is the conventional audio file extension; naming it
# ".mp4" would read as a video file to anyone browsing Storage directly.
MIME_EXTENSIONS: dict[str, str] = {
    "audio/webm": "webm",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
}


class LeadAudioRuleError(ValueError):
    """An audio upload request violates a registry rule. Carries a user-facing message."""


def extension_for(mime: str) -> str | None:
    return MIME_EXTENSIONS.get(mime)


def validate_mime(mime: str) -> None:
    """Raise LeadAudioRuleError with an actionable message if mime is not accepted."""
    if mime not in MIME_EXTENSIONS:
        allowed = ", ".join(sorted(MIME_EXTENSIONS))
        raise LeadAudioRuleError(f"Unsupported audio type '{mime}' (allowed: {allowed})")


def build_key(lead_id: UUID | str, recording_id: UUID | str, mime: str) -> str:
    """Storage key for the recording: '{lead_id}/{recording_id}.{ext}'."""
    ext = extension_for(mime)
    if ext is None:
        raise LeadAudioRuleError(f"Unsupported audio type '{mime}'")
    return f"{lead_id}/{recording_id}.{ext}"
