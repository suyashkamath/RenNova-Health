"""Password hashing, JWT issue/verify, and refresh-token hashing.

Security posture (from the design doc §B.7/§B.11):
- bcrypt for passwords, compared in the app, never in SQL.
- JWT HS256 with the signing algorithm PINNED on decode (rejects alg:none / RS256
  confusion attacks).
- JWT secret loaded from env; the app REFUSES TO BOOT if it is unset (no hardcoded
  fallback that would allow token forgery).
- Refresh tokens are random 32-byte values; only their SHA-256 hash is stored.
"""
from __future__ import annotations

import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

_ALGO = "HS256"
ACCESS_TTL_MIN = int(os.environ.get("AUTH_ACCESS_TTL_MIN") or 60)
REFRESH_TTL_DAYS = int(os.environ.get("AUTH_REFRESH_TTL_DAYS") or 14)

# bcrypt hard-caps the input at 72 bytes; longer passwords are silently truncated
# by the C lib, which is a subtle footgun. Reject them explicitly instead.
_BCRYPT_MAX_BYTES = 72


def jwt_secret() -> str:
    """Fail closed: refuse to operate without a strong secret."""
    s = os.environ.get("AUTH_JWT_SECRET")
    if not s or len(s) < 32:
        raise RuntimeError(
            "AUTH_JWT_SECRET is unset or too short (need >= 32 chars). "
            "Refusing to sign/verify tokens with a weak/absent secret."
        )
    return s


def assert_secret_present() -> None:
    """Call at startup so the process dies loudly rather than at first login."""
    jwt_secret()


# ── Passwords ───────────────────────────────────────────────────────────────
def hash_password(plain: str) -> str:
    if len(plain.encode("utf-8")) > _BCRYPT_MAX_BYTES:
        raise ValueError("Password too long (max 72 bytes).")
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("ascii")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8")[:_BCRYPT_MAX_BYTES], hashed.encode("ascii"))
    except (ValueError, TypeError):
        return False


# ── Access tokens (JWT) ──────────────────────────────────────────────────────
def issue_access_token(claims: dict) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        **claims,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=ACCESS_TTL_MIN)).timestamp()),
        "typ": "access",
    }
    return jwt.encode(payload, jwt_secret(), algorithm=_ALGO)


def decode_access_token(token: str) -> dict:
    """Raises jwt.PyJWTError on any problem. Algorithm is pinned to HS256."""
    payload = jwt.decode(
        token,
        jwt_secret(),
        algorithms=[_ALGO],            # pinned — alg:none and RS256 are rejected here
        options={"require": ["exp", "sub"]},
    )
    if payload.get("typ") != "access":
        raise jwt.InvalidTokenError("not an access token")
    return payload


# ── Refresh tokens (opaque, stored hashed) ────────────────────────────────────
def new_refresh_token() -> tuple[str, str]:
    """Return (raw_token_to_hand_to_client, sha256_hash_to_store)."""
    raw = secrets.token_urlsafe(32)
    return raw, hash_token(raw)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()
