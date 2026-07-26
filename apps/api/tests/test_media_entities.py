"""Pure unit tests for the polymorphic media registry rules (module 08 gate).

No DB, no network, no heavy deps — proves the WHITELIST/pairing/key-layout logic
that stands between `media.entity_id` (no FK possible) and SQL injection / a
broken bucket read policy. Runs anywhere `python -m pytest` runs.
"""
import pytest

from src.services.media_entities import (
    CONSENT_GATED_ENTITY_TYPES,
    ENTITY_TABLES,
    KNOWN_ENTITY_TYPES,
    MIME_EXTENSIONS,
    VALID_PAIRINGS,
    MediaRuleError,
    build_key,
    extension_for,
    is_valid_pairing,
    requires_consent,
    table_for,
    thumb_key_for,
    validate_request,
)

# The exact CHECK constraint values from supabase/migrations/0025_media.sql —
# hand-copied so a source edit that silently drifts from the migration fails here.
MIGRATION_ENTITY_TYPES = frozenset(
    {"customer", "order", "order_item", "production_event", "delivery"}
)
MIGRATION_KINDS = frozenset(
    {"reference", "drawing", "site", "production", "finished", "delivery"}
)
MIGRATION_MIMES = frozenset({"image/jpeg", "image/png", "image/webp"})


# ── table_for: the whitelist ────────────────────────────────────────────────
def test_table_for_known_entities():
    assert table_for("customer") == "customers"
    assert table_for("order") == "orders"
    assert table_for("order_item") == "order_items"
    assert table_for("production_event") == "production_events"


def test_table_for_delivery_is_none():
    # 'delivery' is a known entity_type (CHECK constraint) but has no table to
    # validate against yet — table_for must say so rather than guessing.
    assert table_for("delivery") is None


def test_table_for_unknown_type_is_none():
    assert table_for("bogus") is None
    assert table_for("") is None


# ── is_valid_pairing: the entity_type x kind matrix ─────────────────────────
def test_is_valid_pairing_valid_combos():
    assert is_valid_pairing("customer", "reference") is True
    assert is_valid_pairing("customer", "site") is True
    assert is_valid_pairing("order_item", "production") is True
    assert is_valid_pairing("order", "delivery") is True
    assert is_valid_pairing("production_event", "finished") is True
    assert is_valid_pairing("delivery", "delivery") is True


def test_is_valid_pairing_invalid_combos():
    # A 'production' photo of a customer is a data-entry bug, not a feature
    # (module 08 header) — this is the pairing the whole table exists to reject.
    assert is_valid_pairing("customer", "production") is False
    assert is_valid_pairing("delivery", "reference") is False
    assert is_valid_pairing("production_event", "reference") is False
    assert is_valid_pairing("order_item", "site") is False


def test_is_valid_pairing_unknown_entity_type_is_false():
    assert is_valid_pairing("bogus", "reference") is False


# ── extension_for ────────────────────────────────────────────────────────────
def test_extension_for_known_mimes():
    assert extension_for("image/jpeg") == "jpg"
    assert extension_for("image/png") == "png"
    assert extension_for("image/webp") == "webp"


def test_extension_for_unknown_mime_is_none():
    assert extension_for("image/gif") is None
    assert extension_for("") is None


# ── requires_consent ──────────────────────────────────────────────────────────
def test_requires_consent_customer_only():
    assert requires_consent("customer") is True
    assert requires_consent("order") is False
    assert requires_consent("order_item") is False
    assert requires_consent("production_event") is False
    assert requires_consent("delivery") is False
    assert requires_consent("bogus") is False


# ── validate_request: ordered rejection branches ────────────────────────────
def test_validate_request_rejects_unknown_entity_type_first():
    with pytest.raises(MediaRuleError, match="Unknown entity_type 'bogus'"):
        validate_request("bogus", "reference", "image/jpeg")
    # Even with an ALSO-bad mime, the unknown-entity_type message wins — proves
    # this is the first branch checked, not just "a" branch.
    with pytest.raises(MediaRuleError, match="Unknown entity_type 'bogus'"):
        validate_request("bogus", "reference", "image/gif")


def test_validate_request_rejects_delivery_before_mime_check():
    # 'delivery' passes the KNOWN_ENTITY_TYPES check, so this proves the
    # Phase-2C-not-shipped rejection fires BEFORE the mime is even inspected.
    with pytest.raises(MediaRuleError, match="Delivery media is not available until Phase 2C"):
        validate_request("delivery", "delivery", "image/gif")
    with pytest.raises(MediaRuleError, match="Delivery media is not available until Phase 2C"):
        validate_request("delivery", "delivery", "image/jpeg")


def test_validate_request_rejects_bad_mime():
    with pytest.raises(MediaRuleError, match="Unsupported image type 'image/gif'"):
        validate_request("customer", "reference", "image/gif")


def test_validate_request_checks_mime_before_pairing():
    # kind='production' is invalid for 'customer' AND mime is invalid — the mime
    # error must win, proving mime is checked before the pairing.
    with pytest.raises(MediaRuleError, match="Unsupported image type"):
        validate_request("customer", "production", "image/gif")


def test_validate_request_rejects_bad_pairing_last():
    with pytest.raises(MediaRuleError, match="kind 'production' is not valid for a customer"):
        validate_request("customer", "production", "image/jpeg")


def test_validate_request_does_not_raise_for_valid_combos():
    validate_request("customer", "reference", "image/jpeg")
    validate_request("customer", "site", "image/png")
    validate_request("order", "drawing", "image/webp")
    validate_request("order_item", "production", "image/jpeg")
    validate_request("production_event", "finished", "image/png")


# ── build_key: storage layout ────────────────────────────────────────────────
def test_build_key_layout_and_extension():
    key = build_key("customer", "cust-1", "media-1", "image/jpeg")
    assert key == "customer/cust-1/media-1.jpg"


def test_build_key_entity_type_is_first_segment():
    # LOAD-BEARING: the bucket read policy tests the first path segment to keep
    # workshop/delivery roles away from customer media (0025_media_policies.sql).
    for entity_type in ("customer", "order", "order_item", "production_event"):
        key = build_key(entity_type, "e-1", "m-1", "image/png")
        assert key.split("/", 1)[0] == entity_type


def test_build_key_extensions_per_mime():
    assert build_key("order", "e", "m", "image/png").endswith(".png")
    assert build_key("order", "e", "m", "image/webp").endswith(".webp")
    assert build_key("order", "e", "m", "image/jpeg").endswith(".jpg")


def test_build_key_raises_on_bad_mime():
    with pytest.raises(MediaRuleError, match="Unsupported image type"):
        build_key("customer", "e", "m", "image/gif")


def test_build_key_raises_on_bad_entity_type():
    with pytest.raises(MediaRuleError, match="Unknown entity_type 'bogus'"):
        build_key("bogus", "e", "m", "image/jpeg")


def test_build_key_checks_mime_before_entity_type():
    # A bad mime AND a bad entity_type together — the mime error must win,
    # proving the extension lookup happens first inside build_key.
    with pytest.raises(MediaRuleError, match="Unsupported image type"):
        build_key("bogus", "e", "m", "image/gif")


def test_build_key_permits_delivery_entity_type():
    # build_key alone does not enforce Phase-2C refusal — that is
    # validate_request's job. 'delivery' is in KNOWN_ENTITY_TYPES, so build_key
    # must not raise for it (proves build_key is a lower-level primitive).
    key = build_key("delivery", "e-1", "m-1", "image/jpeg")
    assert key == "delivery/e-1/m-1.jpg"


# ── thumb_key_for ─────────────────────────────────────────────────────────────
def test_thumb_key_for_jpg():
    assert thumb_key_for("customer/e/m.jpg") == "customer/e/m_thumb.jpg"


def test_thumb_key_for_always_jpg_regardless_of_source_extension():
    assert thumb_key_for("order/e/m.webp") == "order/e/m_thumb.jpg"
    assert thumb_key_for("order/e/m.png") == "order/e/m_thumb.jpg"


def test_thumb_key_for_key_with_dots_in_path_segments():
    # Only the LAST dot (the file extension) is stripped; dots earlier in the
    # path (e.g. inside an entity_id) must survive untouched.
    key = "order_item/a.b.c/xyz.png"
    assert thumb_key_for(key) == "order_item/a.b.c/xyz_thumb.jpg"


# ── whitelist/matrix consistency with the 0025 CHECK constraints ────────────
def test_known_entity_types_matches_migration_check_constraint():
    assert KNOWN_ENTITY_TYPES == MIGRATION_ENTITY_TYPES


def test_mime_extensions_matches_migration_check_constraint():
    assert frozenset(MIME_EXTENSIONS) == MIGRATION_MIMES


def test_valid_pairings_covers_every_known_entity_type():
    assert set(VALID_PAIRINGS.keys()) == set(KNOWN_ENTITY_TYPES)


def test_valid_pairings_kinds_are_subset_of_migration_check_constraint():
    all_kinds = frozenset().union(*VALID_PAIRINGS.values())
    assert all_kinds <= MIGRATION_KINDS


def test_entity_tables_is_subset_of_known_entity_types():
    assert set(ENTITY_TABLES) < KNOWN_ENTITY_TYPES  # strict: 'delivery' is excluded


def test_consent_gated_entity_types_is_subset_of_known_entity_types():
    assert CONSENT_GATED_ENTITY_TYPES <= KNOWN_ENTITY_TYPES


# ── 'site' is customer-only (database-review CRITICAL-1) ────────────────────
# A site photo is the inside of somebody's home. BOTH protection boundaries — the
# media_select row policy and the bucket read policy — discriminate on entity_type,
# and the bucket policy can see nothing but the first path segment of the key. So a
# site photo filed against an order would sit outside both and be readable by
# workshop_manager/delivery. Mirrored as the DB CHECK media_site_is_customer_scoped
# (0025); test_production_empirical proves the DB half.
def test_site_kind_is_only_valid_on_the_customer_entity():
    assert is_valid_pairing("customer", "site")
    for entity_type in KNOWN_ENTITY_TYPES - {"customer"}:
        assert not is_valid_pairing(entity_type, "site"), (
            f"'site' must not be allowed on {entity_type} — it would escape both"
            " the media_select policy and the bucket read policy"
        )


def test_site_on_a_non_customer_entity_is_rejected_by_validate_request():
    with pytest.raises(MediaRuleError, match="site"):
        validate_request("order", "site", "image/jpeg")
    with pytest.raises(MediaRuleError, match="site"):
        validate_request("order_item", "site", "image/jpeg")
