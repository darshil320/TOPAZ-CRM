"""Shared FastAPI dependencies for Phase 2 write routers.

Dashboard server actions authenticate server-to-server with the pre-shared
DASHBOARD_API_KEY (§19-G: the key never reaches the browser). Reads go straight to
Supabase under RLS; only side-effecting writes come through FastAPI.
"""

import hmac

from fastapi import Header, HTTPException, status

from ..config import get_settings


def require_dashboard_key(api_key: str = Header(alias="API-Key")) -> None:
    """Constant-time check of the dashboard pre-shared key. 503 if unconfigured."""
    settings = get_settings()
    if not settings.DASHBOARD_API_KEY:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Writes not configured")
    if not hmac.compare_digest(settings.DASHBOARD_API_KEY.encode(), api_key.encode()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")
