"""QR sticker sheets → HTML for the PDF renderer (0053). PURE apart from the lazy
segno import — no DB, no network.

Two print paths, because the showroom may own either kind of printer:

  * "sheet" — A4 pages tiled with stickers, for pre-cut A4 label sheets on any office
    printer. The grid is computed from the sticker size, so a new size is a preset,
    not a layout change.
  * "roll"  — one sticker per PDF page, page size = the label, for a thermal label
    printer (TSC/Zebra/TVS) fed from a roll.

Every QR is vector SVG, so it prints with hard module edges at any DPI — a blurry
raster QR is the most common reason a small sticker scans slowly.

Scan-speed choices: error correction "M" (15% — survives scuffs and a dusty godown)
which segno raises further when the URL still fits the same QR version, and a quiet
zone of QUIET_ZONE_MODULES. Sizes keep each module ≥ ~0.5 mm, which phone cameras
lock onto from a normal arm's length.

Unit-tested by tests/test_qr_stickers.py.
"""

from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

_TEMPLATE_NAME = "qr_stickers.html"

# QR quiet zone, in modules. The spec says 4; the sticker's own padding adds to it, and
# 3 buys a larger QR on a 25 mm sticker without measurably slowing recognition.
QUIET_ZONE_MODULES = 3
ERROR_CORRECTION = "m"

# A4 sheet geometry for the "sheet" layout (mm).
SHEET_WIDTH_MM = 210.0
SHEET_HEIGHT_MM = 297.0
SHEET_MARGIN_MM = 8.0
SHEET_GAP_MM = 2.0

LAYOUTS = ("sheet", "roll")


@dataclass(frozen=True)
class StickerSize:
    key: str
    label: str
    width_mm: float
    height_mm: float
    qr_mm: float
    # "stack": QR on top, text below. "side": QR left, text right (wide labels).
    arrangement: str
    show_name: bool


STICKER_SIZES: dict[str, StickerSize] = {
    s.key: s
    for s in (
        StickerSize("small", "Small · 25 × 25 mm", 25, 25, 19, "stack", False),
        StickerSize("medium", "Medium · 38 × 25 mm", 38, 25, 21, "side", True),
        StickerSize("large", "Large · 50 × 50 mm", 50, 50, 36, "stack", True),
    )
}


def sticker_pdf_key(job_id: UUID | str) -> str:
    """Storage key of a rendered sheet in DOCUMENTS_BUCKET. The id is re-parsed as a
    UUID so nothing but a uuid can ever reach a key. Sheets are disposable — the
    stickers can be re-printed any time — so `stickers/` may be purged freely."""
    return f"stickers/{UUID(str(job_id))}.pdf"


class StickerError(ValueError):
    """A sticker request that cannot be laid out. Carries a user-facing message."""


def sheet_grid(size: StickerSize) -> tuple[int, int]:
    """(columns, rows) of `size` stickers that fit one A4 sheet inside its margins."""
    usable_w = SHEET_WIDTH_MM - 2 * SHEET_MARGIN_MM + SHEET_GAP_MM
    usable_h = SHEET_HEIGHT_MM - 2 * SHEET_MARGIN_MM + SHEET_GAP_MM
    cols = int(usable_w // (size.width_mm + SHEET_GAP_MM))
    rows = int(usable_h // (size.height_mm + SHEET_GAP_MM))
    if cols < 1 or rows < 1:
        raise StickerError(f"{size.label} does not fit on an A4 sheet")
    return cols, rows


def expand_copies(products: list[dict], copies: int) -> list[dict]:
    """Each product `copies` times, adjacent — a 3-piece set prints three in a row."""
    if copies < 1:
        raise StickerError("Print at least one copy of each sticker")
    return [p for p in products for _ in range(copies)]


def paginate(items: list, per_page: int) -> list[list]:
    if per_page < 1:
        raise StickerError("A page must hold at least one sticker")
    return [items[i:i + per_page] for i in range(0, len(items), per_page)]


def qr_svg(url: str) -> str:
    """Inline SVG for `url`, sized by its container (no width/height attributes)."""
    import segno

    qr = segno.make_qr(url, error=ERROR_CORRECTION)
    return qr.svg_inline(border=QUIET_ZONE_MODULES, omitsize=True, dark="#000")


def qr_data_uri(url: str) -> str:
    """`url` as a self-contained SVG data URI with a white background — for an <img>
    preview on screen (dark mode included: a scanner needs the light quiet zone)."""
    import segno

    qr = segno.make_qr(url, error=ERROR_CORRECTION)
    return qr.svg_data_uri(border=QUIET_ZONE_MODULES, omitsize=True, dark="#000", light="#fff")


def build_context(
    products: list[dict], *, size_key: str, layout: str, copies: int, base_url: str
) -> dict:
    """Everything the template needs. `products` carry name + qr_code, nothing else —
    a sticker is stuck on furniture customers walk past, so it never shows a price."""
    from .product_codes import product_url

    size = STICKER_SIZES.get(size_key)
    if size is None:
        raise StickerError(f"Unknown sticker size '{size_key}'")
    if layout not in LAYOUTS:
        raise StickerError(f"Unknown layout '{layout}' (use sheet or roll)")
    if not products:
        raise StickerError("Choose at least one product to print")

    stickers = [
        {"name": p["name"], "code": p["qr_code"], "svg": qr_svg(product_url(base_url, p["qr_code"]))}
        for p in expand_copies(products, copies)
    ]
    if layout == "roll":
        cols, rows = 1, 1
    else:
        cols, rows = sheet_grid(size)
    return {
        "size": size,
        "layout": layout,
        "cols": cols,
        "pages": paginate(stickers, cols * rows),
        "sheet": {
            "width_mm": SHEET_WIDTH_MM,
            "height_mm": SHEET_HEIGHT_MM,
            "margin_mm": SHEET_MARGIN_MM,
            "gap_mm": SHEET_GAP_MM,
        },
    }


def render_stickers_html(
    products: list[dict], *, size_key: str, layout: str, copies: int, base_url: str
) -> str:
    from jinja2 import Environment, FileSystemLoader, select_autoescape

    context = build_context(
        products, size_key=size_key, layout=layout, copies=copies, base_url=base_url
    )
    template_dir = Path(__file__).resolve().parent.parent / "templates"
    env = Environment(
        loader=FileSystemLoader(str(template_dir)),
        autoescape=select_autoescape(["html"]),
    )
    return env.get_template(_TEMPLATE_NAME).render(**context)
