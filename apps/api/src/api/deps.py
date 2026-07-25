"""Shared FastAPI dependencies for Phase 2 write routers.

Dashboard server actions authenticate server-to-server with the pre-shared
DASHBOARD_API_KEY (§19-G: the key never reaches the browser). Reads go straight to
Supabase under RLS; only side-effecting writes come through FastAPI.
"""

import functools
import hmac

from fastapi import Header, HTTPException, status

from ..config import get_settings


@functools.lru_cache(maxsize=4)
def _jwk_client(jwks_url: str):
    """Cached JWKS client for a project's asymmetric signing keys. PyJWKClient
    caches the fetched keys internally and refetches on an unknown `kid`."""
    from jwt import PyJWKClient

    return PyJWKClient(jwks_url)


def require_dashboard_key(api_key: str = Header(alias="API-Key")) -> None:
    """Constant-time check of the dashboard pre-shared key. 503 if unconfigured."""
    settings = get_settings()
    if not settings.DASHBOARD_API_KEY:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Writes not configured")
    if not hmac.compare_digest(settings.DASHBOARD_API_KEY.encode(), api_key.encode()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")


def get_caller_uid(authorization: str = Header(alias="Authorization")) -> str:
    """Verify the forwarded Supabase access token and return its `sub` (the auth
    user id). Identity for money/write routes is derived from THIS verified token,
    never from a request body field (security-review HIGH-3/4).

    Supabase signs access tokens with either the legacy HS256 shared secret OR the
    newer asymmetric keys (ES256/RS256) exposed via the project JWKS. We branch on
    the token's `alg` header: HS256 → `SUPABASE_JWT_SECRET`; ES256/RS256 → the
    project JWKS at `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`.

    Fails closed: 503 if the needed secret/URL is unconfigured, 401 on any bad
    token. PyJWT is imported lazily so the pure test suite runs without the dep.
    """
    settings = get_settings()
    token = authorization.removeprefix("Bearer ").strip()
    try:
        import jwt

        alg = jwt.get_unverified_header(token).get("alg", "")
        if alg == "HS256":
            if not settings.SUPABASE_JWT_SECRET:
                raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                                    detail="Identity verification not configured")
            claims = jwt.decode(
                token, settings.SUPABASE_JWT_SECRET, algorithms=["HS256"],
                audience="authenticated",
            )
        elif alg in ("ES256", "RS256"):
            if not settings.SUPABASE_URL:
                raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                                    detail="Identity verification not configured")
            jwks_url = f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/.well-known/jwks.json"
            signing_key = _jwk_client(jwks_url).get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token, signing_key.key, algorithms=[alg],
                audience="authenticated",
            )
        else:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                                detail="Unsupported token algorithm")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Invalid or expired session") from exc
    sub = claims.get("sub")
    if not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing subject")
    return str(sub)
