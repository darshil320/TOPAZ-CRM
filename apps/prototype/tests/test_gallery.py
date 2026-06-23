"""Unit tests for the gallery: persistence round-trip + identification."""

import os

from src.faces.gallery import Gallery, Person


def _person(name, vec, interest="sofa"):
    return Person(name=name, interest=interest, embedding=vec)


def test_with_person_is_immutable():
    g0 = Gallery()
    g1 = g0.with_person(_person("A", [1.0, 0.0]))
    assert len(g0) == 0
    assert len(g1) == 1


def test_save_and_load_round_trip(tmp_path):
    path = os.path.join(tmp_path, "gallery.json")
    g = Gallery().with_person(_person("Hemant", [1.0, 0.0, 0.0], "7-seater sofa"))
    g.save(path)
    loaded = Gallery.load(path)
    assert len(loaded) == 1
    assert loaded.people[0].name == "Hemant"
    assert loaded.people[0].interest == "7-seater sofa"
    assert loaded.people[0].embedding == [1.0, 0.0, 0.0]


def test_load_missing_file_returns_empty():
    g = Gallery.load("/nonexistent/path/gallery.json")
    assert len(g) == 0


def test_identify_repeat_resolves_person():
    g = (
        Gallery()
        .with_person(_person("Hemant", [1.0, 0.0, 0.0], "sofa"))
        .with_person(_person("Asha", [0.0, 1.0, 0.0], "dining"))
    )
    ident = g.identify([0.97, 0.03, 0.0])
    assert ident.result.band == "repeat"
    assert ident.person is not None
    assert ident.person.name == "Hemant"


def test_identify_new_when_no_close_match():
    g = Gallery().with_person(_person("Hemant", [1.0, 0.0, 0.0]))
    ident = g.identify([0.0, 0.0, 1.0])
    assert ident.result.band == "new"
    assert ident.person is None


def test_identify_on_empty_gallery_is_new():
    ident = Gallery().identify([1.0, 0.0])
    assert ident.result.band == "new"
    assert ident.person is None
