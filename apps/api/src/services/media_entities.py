"""Pure rules for the polymorphic `media` registry.

`media.entity_id` has NO foreign key (one column pointing at five tables cannot),
so this module is the integrity boundary the API enforces before a row is written:

  * `table_for()` is a WHITELIST lookup — an entity_type never reaches SQL as a
    string, so a mapped table name is the only thing that can be interpolated.
  * `is_valid_pairing()` closes the 30-way entity_type x kind cross-product down to
    the combinations that mean something (a 'production' photo of a customer is a
    data-entry bug, not a feature).
  * `build_key()` / `thumb_key_for()` own the Storage key layout, which the bucket
    read policy depends on (supabase/storage/0025_media_policies.sql keys off the
    first path segment being the entity_type).

No I/O, no DB, no heavy imports — unit-tested by tests/test_media_entities.py.
"""

from uuid import UUID

# entity_type → the table whose `id` an entity_id must exist in. 'delivery' is
# deliberately ABSENT: the enum value is reserved for Phase 2C, but no deliveries
# table exists yet, so there is nothing to validate against and the API must refuse.
ENTITY_TABLES: dict[str, str] = {
    "customer": "customers",
    "order": "orders",
    "order_item": "order_items",
    "production_event": "production_events",
}

# Every entity_type the CHECK constraint allows, including the not-yet-buildable one.
KNOWN_ENTITY_TYPES: frozenset[str] = frozenset(ENTITY_TABLES) | {"delivery"}

# Which media kinds make sense on which entity.
#
# 'site' (the inside of somebody's home) appears ONLY under 'customer'. That is not
# a taste call — both protection boundaries discriminate on entity_type (the bucket
# read policy can see nothing but the first path segment of the key), so a site
# photo filed against an order would sit outside both. Mirrored as a DB CHECK,
# media_site_is_customer_scoped (migration 0025) — do not relax one without the other.
VALID_PAIRINGS: dict[str, frozenset[str]] = {
    "customer": frozenset({"reference", "site"}),
    "order": frozenset({"reference", "drawing", "finished", "delivery"}),
    "order_item": frozenset({"reference", "drawing", "production", "finished"}),
    "production_event": frozenset({"production", "finished"}),
    "delivery": frozenset({"delivery"}),
}

# Upload mime → file extension. Also the allowlist: an unmapped mime is rejected.
MIME_EXTENSIONS: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}

# Media on these entity types is personal data about a customer and needs an active
# personal_data consent before it may be stored (DPDPA — see 0025 header).
CONSENT_GATED_ENTITY_TYPES: frozenset[str] = frozenset({"customer"})


class MediaRuleError(ValueError):
    """A media request violates a registry rule. Carries a user-facing message."""


def table_for(entity_type: str) -> str | None:
    """The table an entity_id of this type must exist in, or None if there is no
    table to check against (unknown type, or the reserved 'delivery')."""
    return ENTITY_TABLES.get(entity_type)


def is_valid_pairing(entity_type: str, kind: str) -> bool:
    return kind in VALID_PAIRINGS.get(entity_type, frozenset())


def extension_for(mime: str) -> str | None:
    return MIME_EXTENSIONS.get(mime)


def requires_consent(entity_type: str) -> bool:
    return entity_type in CONSENT_GATED_ENTITY_TYPES


def validate_request(entity_type: str, kind: str, mime: str) -> None:
    """Raise MediaRuleError with an actionable message if the combination is not
    storable. Ordered cheapest-first; every branch names what the caller got wrong."""
    if entity_type not in KNOWN_ENTITY_TYPES:
        raise MediaRuleError(f"Unknown entity_type '{entity_type}'")
    if entity_type == "delivery":
        raise MediaRuleError("Delivery media is not available until Phase 2C")
    if mime not in MIME_EXTENSIONS:
        allowed = ", ".join(sorted(MIME_EXTENSIONS))
        raise MediaRuleError(f"Unsupported image type '{mime}' (allowed: {allowed})")
    if not is_valid_pairing(entity_type, kind):
        allowed = ", ".join(sorted(VALID_PAIRINGS.get(entity_type, frozenset()))) or "none"
        raise MediaRuleError(f"kind '{kind}' is not valid for a {entity_type} (allowed: {allowed})")


def build_key(entity_type: str, entity_id: UUID | str, media_id: UUID | str, mime: str) -> str:
    """Storage key for the full-size object.

    Layout is load-bearing: the bucket read policy tests the FIRST path segment to
    keep workshop/delivery roles away from customer media, so entity_type must stay
    the leading segment.
    """
    ext = extension_for(mime)
    if ext is None:
        raise MediaRuleError(f"Unsupported image type '{mime}'")
    if entity_type not in KNOWN_ENTITY_TYPES:
        raise MediaRuleError(f"Unknown entity_type '{entity_type}'")
    return f"{entity_type}/{entity_id}/{media_id}.{ext}"


def thumb_key_for(storage_key: str) -> str:
    """Thumbnails are always JPEG, alongside the original: `<key-without-ext>_thumb.jpg`."""
    base = storage_key.rsplit(".", 1)[0]
    return f"{base}_thumb.jpg"
