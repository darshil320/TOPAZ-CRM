"""Unit tests for the pure matching logic — no ML deps required."""

import pytest
from src.faces import matching as m


def test_cosine_identical_vectors_is_one():
    v = [0.1, 0.2, 0.3, 0.4]
    assert m.cosine_similarity(v, v) == pytest.approx(1.0)


def test_cosine_orthogonal_vectors_is_zero():
    assert m.cosine_similarity([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)


def test_cosine_opposite_vectors_is_minus_one():
    assert m.cosine_similarity([1.0, 1.0], [-1.0, -1.0]) == pytest.approx(-1.0)


def test_cosine_zero_vector_is_zero_not_error():
    assert m.cosine_similarity([0.0, 0.0], [1.0, 2.0]) == 0.0


def test_cosine_length_mismatch_raises():
    with pytest.raises(ValueError):
        m.cosine_similarity([1.0, 2.0], [1.0])


def test_best_match_picks_closest():
    gallery = [[1.0, 0.0], [0.0, 1.0], [0.9, 0.1]]
    idx, score = m.best_match([1.0, 0.05], gallery)
    assert idx == 0
    assert score > 0.99


def test_best_match_empty_gallery():
    assert m.best_match([1.0, 0.0], []) == (None, 0.0)


@pytest.mark.parametrize(
    "score,expected",
    [
        (0.95, m.BAND_REPEAT),
        (0.45, m.BAND_REPEAT),
        (0.44, m.BAND_UNCERTAIN),
        (0.30, m.BAND_UNCERTAIN),
        (0.29, m.BAND_NEW),
        (0.0, m.BAND_NEW),
    ],
)
def test_classify_bands(score, expected):
    assert m.classify(score) == expected


def test_classify_invalid_thresholds_raise():
    with pytest.raises(ValueError):
        m.classify(0.5, match_threshold=0.2, new_threshold=0.4)


def test_identify_empty_gallery_is_new():
    res = m.identify([1.0, 0.0], [])
    assert res.band == m.BAND_NEW
    assert res.index is None
    assert res.score == 0.0


def test_identify_repeat_returns_index():
    gallery = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]
    res = m.identify([0.98, 0.02, 0.0], gallery)
    assert res.band == m.BAND_REPEAT
    assert res.index == 0
    assert res.score > 0.9


def test_identify_new_drops_index():
    gallery = [[1.0, 0.0, 0.0]]
    res = m.identify([0.0, 1.0, 0.0], gallery)
    assert res.band == m.BAND_NEW
    assert res.index is None
