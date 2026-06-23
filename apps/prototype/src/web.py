"""Live visit-log web view (stdlib only — no Flask/FastAPI).

A tiny dashboard showing recent showroom visits with the captured photo for new
visitors. Auto-refreshes every few seconds. Also serves `data/captures/` at
`/captures/<file>` so photos render here AND can be exposed publicly (e.g. ngrok)
for WhatsApp media attachment (see notify.media / demo.py).

Run:
    python -m src.web            # http://localhost:8077

This is the seed of the Phase 1A M6A dashboard (master plan E1A-6).
Routes:
    GET /              HTML dashboard (meta-refresh)
    GET /api/visits    JSON of recent visits
    GET /captures/<f>  static capture image (path-traversal safe)
"""

from __future__ import annotations

import html
import json
import os
from dataclasses import asdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

from .config import Config
from .store.visit_log import Visit, VisitLog

REFRESH_SECONDS = 4
CAPTURES_ROUTE = "/captures/"


def _band_color(band: str) -> str:
    return {"repeat": "#1f9d55", "new": "#d98324", "uncertain": "#8a8a8a"}.get(band, "#6b7280")


def render_page(visits: list[Visit], captures_prefix: str = "/captures") -> str:
    """Render the dashboard HTML. Pure function — unit-tested.

    `visits` newest-last; we display newest-first.
    """
    rows = []
    for v in reversed(visits):
        color = _band_color(v.band)
        name = html.escape(v.name or ("New visitor" if v.band == "new" else "Unknown"))
        interest = html.escape(v.interest or "—")
        when = html.escape(v.occurred_at)
        score = f"{v.score:.2f}"
        photo_cell = "—"
        if v.photo_path:
            fname = html.escape(os.path.basename(v.photo_path))
            photo_cell = (
                f'<img class="thumb" src="{captures_prefix}/{fname}" alt="capture" loading="lazy"/>'
            )
        rows.append(
            f"<tr>"
            f'<td><span class="pill" style="background:{color}">{html.escape(v.band)}</span></td>'
            f'<td class="name">{name}</td>'
            f"<td>{interest}</td>"
            f'<td class="mono">{score}</td>'
            f'<td class="mono">{when}</td>'
            f"<td>{photo_cell}</td>"
            f"</tr>"
        )
    body_rows = (
        "\n".join(rows)
        if rows
        else (
            '<tr><td colspan="6" class="empty">No visits yet — start <code>python -m src.demo</code> '
            "and step in front of the camera.</td></tr>"
        )
    )
    total = len(visits)
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta http-equiv="refresh" content="{REFRESH_SECONDS}"/>
<title>Topaz — Live Visits</title>
<style>
  :root {{ color-scheme: dark; }}
  * {{ box-sizing: border-box; }}
  body {{ margin:0; font-family:-apple-system,Segoe UI,Roboto,sans-serif;
         background:#0f1115; color:#e8e8ea; }}
  header {{ padding:20px 28px; border-bottom:1px solid #23262d;
            display:flex; align-items:baseline; gap:14px; }}
  header h1 {{ font-size:18px; margin:0; letter-spacing:.3px; }}
  header .accent {{ color:#E0A33C; }}
  header .meta {{ color:#8a8f98; font-size:13px; margin-left:auto; }}
  table {{ width:100%; border-collapse:collapse; }}
  th,td {{ text-align:left; padding:12px 28px; border-bottom:1px solid #1c1f26; font-size:14px; }}
  th {{ color:#8a8f98; font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:.5px; }}
  td.name {{ font-weight:600; }}
  .mono {{ font-variant-numeric:tabular-nums; color:#b8bcc4; }}
  .pill {{ display:inline-block; padding:2px 10px; border-radius:999px; color:#fff;
           font-size:12px; font-weight:600; text-transform:capitalize; }}
  .thumb {{ height:48px; width:48px; object-fit:cover; border-radius:8px; border:1px solid #2a2e36; }}
  .empty {{ color:#8a8f98; text-align:center; padding:40px; }}
  code {{ background:#1c1f26; padding:2px 6px; border-radius:5px; color:#E0A33C; }}
</style>
</head>
<body>
<header>
  <h1>Topaz <span class="accent">Showroom Intelligence</span></h1>
  <span class="meta">{total} visit(s) · auto-refresh {REFRESH_SECONDS}s</span>
</header>
<table>
  <thead><tr><th>Type</th><th>Customer</th><th>Interest</th><th>Score</th><th>Time</th><th>Photo</th></tr></thead>
  <tbody>
{body_rows}
  </tbody>
</table>
</body>
</html>"""


def _safe_capture_path(captures_dir: str, url_path: str) -> str | None:
    """Resolve a /captures/<file> request to a safe path inside captures_dir."""
    name = os.path.basename(unquote(url_path[len(CAPTURES_ROUTE) :]))
    if not name:
        return None
    full = os.path.join(captures_dir, name)
    # basename already strips traversal; double-check containment.
    if os.path.commonpath(
        [os.path.abspath(full), os.path.abspath(captures_dir)]
    ) != os.path.abspath(captures_dir):
        return None
    return full if os.path.isfile(full) else None


def _make_handler(config: Config):
    visit_log = VisitLog(config.visits_path)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):  # silence default noisy logging
            pass

        def _send(self, code: int, body: bytes, content_type: str) -> None:
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802 (stdlib naming)
            path = urlparse(self.path).path
            if path == "/":
                html_doc = render_page(visit_log.recent(limit=50))
                self._send(200, html_doc.encode("utf-8"), "text/html; charset=utf-8")
                return
            if path == "/api/visits":
                payload = json.dumps(
                    [asdict(v) for v in visit_log.recent(limit=50)], ensure_ascii=False
                )
                self._send(200, payload.encode("utf-8"), "application/json; charset=utf-8")
                return
            if path.startswith(CAPTURES_ROUTE):
                full = _safe_capture_path(config.captures_dir, path)
                if full is None:
                    self._send(404, b"not found", "text/plain")
                    return
                with open(full, "rb") as fh:
                    self._send(200, fh.read(), "image/jpeg")
                return
            self._send(404, b"not found", "text/plain")

    return Handler


def run() -> int:
    config = Config.from_env()
    handler = _make_handler(config)
    server = ThreadingHTTPServer(("0.0.0.0", config.web_port), handler)
    print(f"Topaz live visit view on http://localhost:{config.web_port}  (Ctrl+C to stop)")
    if config.public_base_url:
        print(
            f"Public base URL: {config.public_base_url} — captures will attach to WhatsApp media."
        )
    else:
        print(
            f"Tip: expose this (e.g. `ngrok http {config.web_port}`) and set PUBLIC_BASE_URL "
            "to attach photos to WhatsApp alerts."
        )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
