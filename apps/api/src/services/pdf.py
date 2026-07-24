"""HTML → PDF rendering. Playwright (headless Chromium) is imported LAZILY so
the pure-logic test suite runs without the browser binary installed
(CLAUDE.md import-light discipline).

Chromium install (documented in README + Dockerfile):
    playwright install --with-deps chromium

Fallback: if container size is a problem, swap render_html_to_pdf for a
WeasyPrint implementation behind the same signature — callers don't change.
"""

import logging

logger = logging.getLogger(__name__)


class PdfRenderError(RuntimeError):
    """Rendering failed or the engine is not installed."""


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
