"""HTML → PDF / image rendering. Playwright (headless Chromium) is imported
LAZILY so the pure-logic test suite runs without the browser binary installed
(CLAUDE.md import-light discipline).

Two outputs, one engine and one set of templates on purpose. A job card rendered
as a JPEG opens INLINE in WhatsApp on a cheap Android — no PDF viewer, no
download, no taps — which is the whole thesis of the workshop-facing UX. A second
hand-written layout engine (e.g. drawing with Pillow) would render the same
document twice and the two would drift; screenshotting the identical HTML cannot.

Chromium install (documented in README + Dockerfile):
    playwright install --with-deps chromium

Fallback: if container size is a problem, swap render_html_to_pdf for a
WeasyPrint implementation behind the same signature — callers don't change.
"""

import logging

logger = logging.getLogger(__name__)


class PdfRenderError(RuntimeError):
    """Rendering failed or the engine is not installed."""


def render_html_to_image(
    html: str, *, width_px: int = 1000, quality: int = 82, scale: int = 2
) -> bytes:
    """Render a full HTML document to a single full-page JPEG. Raises PdfRenderError.

    JPEG (not PNG) because WhatsApp's image endpoint takes image/jpeg and a photo
    of a spec sheet has no transparency to preserve — PNG would be several times
    larger for no gain.

    `scale=2` renders at 2x device pixel ratio then WhatsApp downscales it, which
    is what keeps small text legible after the platform's own recompression. Width
    is fixed rather than derived so every job card looks identical on every handset.

    Synchronous (Celery workers are sync) via Playwright's sync API — callers under
    an event loop MUST wrap this in asyncio.to_thread (see tasks/job_card.py).
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:  # pragma: no cover - depends on optional dep
        raise PdfRenderError(
            "playwright not installed — run `playwright install chromium`"
        ) from exc

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--no-sandbox"])
            try:
                page = browser.new_page(
                    viewport={"width": width_px, "height": 1400},
                    device_scale_factor=scale,
                )
                page.set_content(html, wait_until="networkidle")
                image = page.screenshot(full_page=True, type="jpeg", quality=quality)
            finally:
                browser.close()
    except Exception as exc:  # pragma: no cover - runtime/browser errors
        raise PdfRenderError(f"Image render failed: {exc}") from exc

    if not image:
        raise PdfRenderError("Image render produced empty output")
    logger.info("Rendered image (%d bytes)", len(image))
    return image


def render_html_to_pdf(html: str) -> bytes:
    """Render a full HTML document to A4 PDF bytes. Raises PdfRenderError.

    Synchronous (Celery workers are sync) via Playwright's sync API.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:  # pragma: no cover - depends on optional dep
        raise PdfRenderError(
            "playwright not installed — run `playwright install chromium`"
        ) from exc

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--no-sandbox"])
            try:
                page = browser.new_page()
                page.set_content(html, wait_until="networkidle")
                pdf = page.pdf(
                    format="A4",
                    print_background=True,
                    margin={"top": "12mm", "bottom": "14mm", "left": "12mm", "right": "12mm"},
                )
            finally:
                browser.close()
    except Exception as exc:  # pragma: no cover - runtime/browser errors
        raise PdfRenderError(f"PDF render failed: {exc}") from exc

    if not pdf:
        raise PdfRenderError("PDF render produced empty output")
    logger.info("Rendered PDF (%d bytes)", len(pdf))
    return pdf
