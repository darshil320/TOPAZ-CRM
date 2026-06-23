"""Unit tests for the pure media-URL helper."""

from src.notify.media import public_url_for


def test_none_when_no_public_base_url():
    assert public_url_for("data/captures/x.jpg", None) is None
    assert public_url_for("data/captures/x.jpg", "") is None


def test_none_when_no_photo():
    assert public_url_for(None, "https://abc.ngrok.io") is None
    assert public_url_for("", "https://abc.ngrok.io") is None


def test_builds_url_from_basename():
    url = public_url_for("data/captures/20260612_140500.jpg", "https://abc.ngrok.io")
    assert url == "https://abc.ngrok.io/captures/20260612_140500.jpg"


def test_strips_trailing_slash_on_base():
    url = public_url_for("data/captures/x.jpg", "https://abc.ngrok.io/")
    assert url == "https://abc.ngrok.io/captures/x.jpg"


def test_uses_only_basename_no_path_escape():
    # A sneaky path must not leak directory structure into the URL.
    url = public_url_for("/etc/passwd", "https://abc.ngrok.io")
    assert url == "https://abc.ngrok.io/captures/passwd"
