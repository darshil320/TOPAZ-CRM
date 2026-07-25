"""get_caller_uid — token verification across Supabase's signing schemes.

Regression for the prod incident where Supabase issued ES256 (asymmetric) access
tokens but the API only verified HS256, rejecting every authenticated write with
"Invalid or expired session". Skips when PyJWT[crypto] is not installed, matching
the repo's lazy-dep discipline (the pure suite runs without jwt/cryptography).
"""
from types import SimpleNamespace

import pytest

jwt = pytest.importorskip("jwt")
ec = pytest.importorskip("cryptography.hazmat.primitives.asymmetric.ec")

from src.api import deps  # noqa: E402
from src.config import get_settings  # noqa: E402
from fastapi import HTTPException  # noqa: E402

SUB = "34eefce2-6f6f-4a7e-a646-93b8748e3ee1"


@pytest.fixture
def settings():
    s = get_settings()
    s.SUPABASE_URL = "https://project.supabase.co"
    s.SUPABASE_JWT_SECRET = "a-legacy-hs256-shared-secret-value"
    return s


def _es256(claims, key, kid="k1"):
    return jwt.encode(claims, key, algorithm="ES256", headers={"kid": kid})


def test_es256_token_verified_via_jwks(settings, monkeypatch):
    priv = ec.generate_private_key(ec.SECP256R1())
    monkeypatch.setattr(
        deps, "_jwk_client",
        lambda url: SimpleNamespace(get_signing_key_from_jwt=lambda t: SimpleNamespace(key=priv.public_key())),
    )
    tok = _es256({"sub": SUB, "aud": "authenticated"}, priv)
    assert deps.get_caller_uid(f"Bearer {tok}") == SUB


def test_hs256_token_still_supported(settings):
    tok = jwt.encode({"sub": "hs-user", "aud": "authenticated"},
                     settings.SUPABASE_JWT_SECRET, algorithm="HS256")
    assert deps.get_caller_uid(f"Bearer {tok}") == "hs-user"


def test_es256_wrong_key_rejected(settings, monkeypatch):
    priv, other = ec.generate_private_key(ec.SECP256R1()), ec.generate_private_key(ec.SECP256R1())
    monkeypatch.setattr(
        deps, "_jwk_client",
        lambda url: SimpleNamespace(get_signing_key_from_jwt=lambda t: SimpleNamespace(key=other.public_key())),
    )
    tok = _es256({"sub": SUB, "aud": "authenticated"}, priv)
    with pytest.raises(HTTPException) as e:
        deps.get_caller_uid(f"Bearer {tok}")
    assert e.value.status_code == 401


def test_garbage_token_rejected(settings):
    with pytest.raises(HTTPException) as e:
        deps.get_caller_uid("Bearer not-a-jwt")
    assert e.value.status_code == 401


def test_es256_requires_supabase_url(settings, monkeypatch):
    settings.SUPABASE_URL = None
    priv = ec.generate_private_key(ec.SECP256R1())
    tok = _es256({"sub": SUB, "aud": "authenticated"}, priv)
    with pytest.raises(HTTPException) as e:
        deps.get_caller_uid(f"Bearer {tok}")
    assert e.value.status_code == 503
