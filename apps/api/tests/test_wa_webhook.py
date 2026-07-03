"""Unit tests for Meta webhook payload parsers (no DB required)."""
from src.services.wa_webhook import parse_inbound_texts, parse_status_updates


def _payload(value: dict) -> dict:
    return {"entry": [{"changes": [{"value": value}]}]}


def test_parse_inbound_text_message():
    payload = _payload(
        {
            "messages": [
                {
                    "type": "text",
                    "from": "919876543210",
                    "id": "wamid.abc123",
                    "timestamp": "1751500000",
                    "text": {"body": "Is the sofa still available?"},
                }
            ]
        }
    )
    messages = parse_inbound_texts(payload)
    assert len(messages) == 1
    assert messages[0].wa_id == "919876543210"
    assert messages[0].wamid == "wamid.abc123"
    assert messages[0].text == "Is the sofa still available?"
    assert messages[0].received_at.startswith("2025") or messages[0].received_at.startswith("2026")


def test_non_text_messages_ignored():
    payload = _payload(
        {"messages": [{"type": "image", "from": "919876543210", "id": "wamid.img"}]}
    )
    assert parse_inbound_texts(payload) == []


def test_missing_fields_ignored():
    payload = _payload(
        {"messages": [{"type": "text", "from": "", "id": "wamid.x", "text": {"body": "hi"}}]}
    )
    assert parse_inbound_texts(payload) == []


def test_empty_payload_safe():
    assert parse_inbound_texts({}) == []
    assert parse_status_updates({}) == []


def test_parse_status_updates():
    payload = _payload(
        {
            "statuses": [
                {"id": "wamid.abc", "status": "delivered"},
                {"id": "wamid.def", "status": "read"},
            ]
        }
    )
    updates = parse_status_updates(payload)
    assert [(u.wamid, u.status) for u in updates] == [
        ("wamid.abc", "delivered"),
        ("wamid.def", "read"),
    ]


def test_unknown_status_values_ignored():
    payload = _payload({"statuses": [{"id": "wamid.abc", "status": "warning"}]})
    assert parse_status_updates(payload) == []


def test_multiple_entries_and_changes():
    payload = {
        "entry": [
            {"changes": [{"value": {"statuses": [{"id": "w1", "status": "sent"}]}}]},
            {"changes": [{"value": {"statuses": [{"id": "w2", "status": "failed"}]}}]},
        ]
    }
    updates = parse_status_updates(payload)
    assert len(updates) == 2


def test_malformed_change_value_ignored():
    payload = {"entry": [{"changes": [{"value": "not-a-dict"}]}]}
    assert parse_inbound_texts(payload) == []
    assert parse_status_updates(payload) == []
