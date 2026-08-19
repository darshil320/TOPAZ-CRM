"""services/line_photos — inlining a line's photo for BOTH documents.

This module became shared the moment the priced quotation started showing the same
photo as the job card. That makes its failure modes matter twice over, and one of them
is subtle: a photo that cannot be fetched must DEGRADE (the row prints "No photo"), not
raise — otherwise one unreadable image costs the customer their quotation or the
workshop its job card.

No network: `download_bytes` is stubbed.
"""
import pytest

from src.config import get_settings
from src.services import line_photos
from src.services.storage import StorageError


@pytest.fixture
def fetches(monkeypatch):
    state = {"blobs": {}, "errors": set(), "calls": []}

    def _download(bucket, key):
        state["calls"].append(key)
        if key in state["errors"]:
            raise StorageError(f"cannot read {key}")
        return state["blobs"][key]

    monkeypatch.setattr(line_photos, "download_bytes", _download)
    return state


@pytest.fixture(autouse=True)
def cap(monkeypatch):
    monkeypatch.setattr(get_settings(), "JOB_CARD_MAX_INLINE_BYTES", 1000)


def test_data_uri_mime_follows_the_extension():
    assert line_photos.data_uri("a/b.png", b"x").startswith("data:image/png;base64,")
    assert line_photos.data_uri("a/b.jpg", b"x").startswith("data:image/jpeg;base64,")
    assert line_photos.data_uri("a/b.jpeg", b"x").startswith("data:image/jpeg;base64,")
    assert line_photos.data_uri("a/b.webp", b"x").startswith("data:image/webp;base64,")
    # Unknown extension falls back to JPEG rather than emitting a broken mime.
    assert line_photos.data_uri("a/b.heic", b"x").startswith("data:image/jpeg;base64,")


def test_photo_is_inlined_and_inputs_are_not_mutated(fetches):
    fetches["blobs"] = {"m/1.jpg": b"bytes"}
    original = {"id": "i1", "photo_key": "m/1.jpg"}

    out = line_photos.inline_photos([original])

    assert out[0]["photo_data_uri"].startswith("data:image/jpeg;base64,")
    assert out[0]["id"] == "i1"
    assert "photo_data_uri" not in original, "inputs must not be mutated"


def test_line_without_a_key_is_none_and_costs_no_fetch(fetches):
    out = line_photos.inline_photos([{"id": "i1"}, {"id": "i2", "photo_key": None}])

    assert [it["photo_data_uri"] for it in out] == [None, None]
    assert fetches["calls"] == []


def test_unreadable_photo_degrades_instead_of_raising(fetches):
    """One bad image must not cost the whole document."""
    fetches["blobs"] = {"good.jpg": b"ok"}
    fetches["errors"] = {"bad.jpg"}

    out = line_photos.inline_photos(
        [{"photo_key": "bad.jpg"}, {"photo_key": "good.jpg"}], document="Quotation"
    )

    assert out[0]["photo_data_uri"] is None
    assert out[1]["photo_data_uri"] is not None


def test_oversized_photo_is_dropped(fetches):
    """The resolver falls back to the full original when no thumbnail exists, so
    without the cap a few un-thumbnailed lines can produce a file WhatsApp refuses."""
    fetches["blobs"] = {"huge.jpg": b"x" * 1001, "small.jpg": b"x" * 999}

    out = line_photos.inline_photos([{"photo_key": "huge.jpg"}, {"photo_key": "small.jpg"}])

    assert out[0]["photo_data_uri"] is None
    assert out[1]["photo_data_uri"] is not None


def test_order_is_preserved(fetches):
    """Line order is document order — a reshuffle would put the wrong photo against
    the wrong price."""
    fetches["blobs"] = {f"{i}.jpg": bytes([i]) for i in range(5)}

    out = line_photos.inline_photos([{"photo_key": f"{i}.jpg", "sort": i} for i in range(5)])

    assert [it["sort"] for it in out] == [0, 1, 2, 3, 4]
    for i, it in enumerate(out):
        assert it["photo_data_uri"] == line_photos.data_uri(f"{i}.jpg", bytes([i]))


def test_empty_list_is_a_no_op(fetches):
    assert line_photos.inline_photos([]) == []
    assert fetches["calls"] == []
