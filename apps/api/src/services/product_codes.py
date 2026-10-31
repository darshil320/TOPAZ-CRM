"""Product QR codes — format, normalisation and the URL a sticker encodes (0053).

The database GENERATES codes (new_product_qr_code(), migration 0053) and refuses to
change one. This module owns what a request does with a code before SQL sees it:
anything that is not a well-formed code is rejected here, so a malformed or hostile
path segment never reaches a query.

Crockford base32 — no I, L, O or U — so a code read off a scuffed sticker or typed by
hand is unambiguous; the common misreads (O for 0, I/L for 1) are folded back.

No I/O, no heavy imports — unit-tested by tests/test_product_codes.py.
"""

import re

CODE_LENGTH = 8
_CODE_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{8}$")
# Crockford's decoding aliases for characters the alphabet leaves out.
_ALIASES = str.maketrans({"O": "0", "I": "1", "L": "1"})
# Separators a person may type when reading a code aloud ("7K3M-9QXA").
_SEPARATORS = re.compile(r"[\s\-_]")


def normalize_code(raw: object) -> str | None:
    """The canonical code for `raw`, or None when it cannot be one."""
    if not isinstance(raw, str) or len(raw) > 32:
        return None
    cleaned = _SEPARATORS.sub("", raw).upper().translate(_ALIASES)
    return cleaned if _CODE_RE.fullmatch(cleaned) else None


def qr_base_url(product_qr_base_url: str | None, dashboard_url: str) -> str:
    """Where sticker URLs point: the explicit setting, else `<dashboard>/p`."""
    base = product_qr_base_url or f"{dashboard_url.rstrip('/')}/p"
    return base.rstrip("/")


def product_url(base_url: str, code: str) -> str:
    """The exact text a sticker's QR encodes. Kept short on purpose: fewer characters
    is a lower QR version — bigger modules on the same sticker, faster scans."""
    return f"{base_url.rstrip('/')}/{code}"
