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


def get_caller_uid(authorization: str = Header(alias="Authorization")) -> str:
    """Verify the forwarded Supabase access token (HS256) and return its `sub`
    (the auth user id). Identity for money/write routes is derived from THIS
    verified token, never from a request body field (security-review HIGH-3/4).

    Fails closed: 503 if the JWT secret is not configured, 401 on any bad token.
    PyJWT is imported lazily so the pure test suite runs without the dep.
    """
    settings = get_settings()
    if not settings.SUPABASE_JWT_SECRET:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="Identity verification not configured")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        import jwt

        claims = jwt.decode(
            token, settings.SUPABASE_JWT_SECRET, algorithms=["HS256"],
            audience="authenticated",
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Invalid or expired session") from exc
    sub = claims.get("sub")
    if not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing subject")
    return str(sub)
