"""Unit tests for the inbound intent classifier (no DB / network required)."""

from src.services.intent import (
    BUYING_SIGNAL,
    CONFUSION,
    INTENT_CALL,
    INTENT_VISIT,
    detect_intents,
)


def _types(text: str) -> set[str]:
    return {h.type for h in detect_intents(text)}


def test_empty_and_none_yield_nothing():
    assert detect_intents(None) == []
    assert detect_intents("") == []
    assert detect_intents("   ") == []


def test_no_signal_message():
    assert detect_intents("Thanks, that looks lovely!") == []


def test_call_intent_english():
    assert INTENT_CALL in _types("Can you call me tomorrow?")
    assert INTENT_CALL in _types("please give me a call")


def test_call_intent_hinglish():
    assert INTENT_CALL in _types("mujhe call karo please")


def test_visit_intent():
    assert INTENT_VISIT in _types("When can I come to the showroom?")
    assert INTENT_VISIT in _types("kal aana hai dukan pe")


def test_buying_signal_english_and_price():
    assert BUYING_SIGNAL in _types("what is the price of the Milano sofa")
    assert BUYING_SIGNAL in _types("I want to buy this")


def test_buying_signal_hinglish():
    assert BUYING_SIGNAL in _types("iska kitna hoga?")


def test_confusion_intent():
    assert CONFUSION in _types("sorry I don't understand")
    assert CONFUSION in _types("ye samajh nahi aaya")


def test_case_insensitive():
    assert INTENT_CALL in _types("CALL ME NOW")


def test_multiple_intents_one_per_type():
    hits = detect_intents("What's the price? Also please call me back.")
    types = [h.type for h in hits]
    assert INTENT_CALL in types
    assert BUYING_SIGNAL in types
    # at most one hit per type
    assert len(types) == len(set(types))


def test_matched_snippet_is_populated():
    hits = detect_intents("please call me")
    assert hits
    assert hits[0].matched  # non-empty phrase that triggered the match


def test_priority_order_call_before_confusion():
    hits = detect_intents("I'm confused, can you call me?")
    order = [h.type for h in hits]
    assert order.index(INTENT_CALL) < order.index(CONFUSION)
