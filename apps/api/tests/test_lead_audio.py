"""Pure rules for lead call-note recordings — services/lead_audio.py.

Scoped to one entity (a lead) on purpose: unlike media_entities.py's polymorphic
5-table cross-product, there is only ever one parent here, so this module is
deliberately smaller (no ENTITY_TABLES/VALID_PAIRINGS).

No I/O, no DB — unit-tested here with zero fixtures.
"""
import pytest

from src.services import lead_audio

ALLOWED_MIMES = ("audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav")


@pytest.mark.parametrize(
    "mime,ext",
    [
        ("audio/webm", "webm"),
        ("audio/mp4", "m4a"),  # conventional audio extension, not "mp4" (reads as video)
        ("audio/mpeg", "mp3"),
        ("audio/ogg", "ogg"),
        ("audio/wav", "wav"),
    ],
)
def test_extension_for_known_mimes(mime, ext):
    assert lead_audio.extension_for(mime) == ext


def test_extension_for_unknown_mime_is_none():
    assert lead_audio.extension_for("audio/aac") is None
    assert lead_audio.extension_for("video/mp4") is None


@pytest.mark.parametrize("mime", ALLOWED_MIMES)
def test_validate_mime_accepts_every_allowed_mime(mime):
    lead_audio.validate_mime(mime)  # must not raise


def test_validate_mime_rejects_unknown_mime_with_actionable_message():
    with pytest.raises(lead_audio.LeadAudioRuleError) as exc:
        lead_audio.validate_mime("audio/aac")
    message = str(exc.value)
    for mime in ALLOWED_MIMES:
        assert mime in message


def test_build_key_format_for_known_mime():
    key = lead_audio.build_key("lead-1", "rec-1", "audio/mpeg")
    assert key == "lead-1/rec-1.mp3"


def test_build_key_rejects_unknown_mime():
    with pytest.raises(lead_audio.LeadAudioRuleError):
        lead_audio.build_key("lead-1", "rec-1", "audio/aac")
