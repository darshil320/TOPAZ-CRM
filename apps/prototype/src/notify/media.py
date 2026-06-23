"""Pure helper: map a local capture file to a public URL for WhatsApp media.

WhatsApp/Twilio attach media only from a publicly reachable URL. The prototype serves
captures via src/web.py at `/captures/<file>`; exposing that server publicly (e.g.
`ngrok http 8077`) and setting PUBLIC_BASE_URL lets alerts carry the photo.

No public base URL configured -> returns None -> notifiers fall back to text-only.
Dependency-free and unit-tested.
"""

from __future__ import annotations

import os

CAPTURES_URL_PREFIX = "captures"


def public_url_for(photo_path: str | None, public_base_url: str | None) -> str | None:
    """Build a public URL for a captured photo, or None if not resolvable.

    Uses only the file's basename, so a stray path can't escape the captures route.
    """
    if not photo_path or not public_base_url:
        return None
    name = os.path.basename(photo_path.strip())
    if not name:
        return None
    base = public_base_url.strip().rstrip("/")
    return f"{base}/{CAPTURES_URL_PREFIX}/{name}"
