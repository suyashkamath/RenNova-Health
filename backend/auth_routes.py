"""Authentication endpoints: login, token refresh, logout, change password.

- bcrypt password check in-app.
- Access JWT (short-lived) + opaque refresh token (rotated, stored hashed).
- Account lockout: DISABLED — unlimited attempts, no temporary lock.
- must_change_password: the change-password endpoint skips the current-password
  check ONLY when that flag is set on the authenticated user (temp-password flow).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

import authdb
import logger as log
import rbac
import security

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Account lockout is DISABLED (per request): unlimited login attempts, no temporary
# lock. A wrong password just returns 401. Failed attempts are still audit-logged.


class LoginBody(BaseModel):
    username: str
    password: str


class RefreshBody(BaseModel):
    refreshToken: str


class ChangePwBody(BaseModel):
    currentPassword: str | None = None
    newPassword: str


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)  # DB stores naive UTC


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _issue_session(user: dict, request: Request) -> dict:
    access = security.issue_access_token({
        "sub": str(user["id"]),
        "username": user["username"],
        "role": user["role_code"],
        "level": user["level"],
    })
    raw_refresh, token_hash = security.new_refresh_token()
    expires = _utcnow() + timedelta(days=security.REFRESH_TTL_DAYS)
    authdb.execute(
        """INSERT INTO dbo.refresh_tokens (user_id, token_hash, expires_at, user_agent, ip)
           VALUES (%s,%s,%s,%s,%s)""",
        [user["id"], token_hash, expires,
         (request.headers.get("user-agent") or "")[:400], _client_ip(request)],
    )
    return {"accessToken": access, "refreshToken": raw_refresh}


def _public_user(user: dict) -> dict:
    return {
        "id": user["id"], "username": user["username"], "email": user["email"],
        "fullName": user["full_name"], "role": user["role_code"], "level": user["level"],
        "mustChangePassword": bool(user["must_change_password"]),
        "scopes": user.get("scopes"),
    }


@router.post("/login")
def login(body: LoginBody, request: Request):
    row = authdb.fetch_one(
        """SELECT u.id, u.username, u.password_hash, u.is_active, u.failed_login_attempts,
                  u.locked_until, u.must_change_password, u.role_id, r.role_code, r.level
           FROM dbo.users u JOIN dbo.roles r ON r.id=u.role_id
           WHERE u.username=%s""",
        [body.username],
    )
    # Uniform error to avoid leaking which usernames exist.
    invalid = HTTPException(401, "Invalid username or password")
    if not row or not row["is_active"]:
        log.warn(f"Login rejected for '{body.username}' (unknown or inactive)")
        raise invalid

    # Lockout removed: no locked_until check, no attempt counting. Just verify.
    if not security.verify_password(body.password, row["password_hash"]):
        rbac.audit(row["id"], "LOGIN_FAIL", "user", row["id"], None, _client_ip(request))
        log.warn(f"Login failed for '{body.username}' (wrong password)")
        log.activity(f"'{body.username}' failed login (wrong password)")
        raise invalid

    authdb.execute(
        "UPDATE dbo.users SET failed_login_attempts=0, locked_until=NULL, last_login_at=(now() AT TIME ZONE 'utc') WHERE id=%s",
        [row["id"]],
    )
    user = rbac.load_user(row["id"])
    session = _issue_session(user, request)
    rbac.audit(user["id"], "LOGIN", "user", user["id"], None, _client_ip(request))
    log.info(f"Login success for '{user['username']}' (id={user['id']}, role={user['role_code']})")
    log.activity(f"'{user['username']}' logged in (role={user['role_code']})")
    return {**session, "user": _public_user(user), "views": rbac.effective_views(user)}


@router.post("/refresh")
def refresh(body: RefreshBody, request: Request):
    token_hash = security.hash_token(body.refreshToken)
    row = authdb.fetch_one(
        """SELECT id, user_id FROM dbo.refresh_tokens
           WHERE token_hash=%s AND revoked_at IS NULL AND expires_at > (now() AT TIME ZONE 'utc')""",
        [token_hash],
    )
    if not row:
        raise HTTPException(401, "Invalid or expired refresh token")
    user = rbac.load_user(row["user_id"])
    if not user:
        raise HTTPException(401, "User not found or deactivated")
    # Rotate: revoke the used token, issue a fresh pair.
    authdb.execute("UPDATE dbo.refresh_tokens SET revoked_at=(now() AT TIME ZONE 'utc') WHERE id=%s", [row["id"]])
    session = _issue_session(user, request)
    log.info(f"Session refreshed for '{user['username']}' (id={user['id']})")
    return {**session, "user": _public_user(user), "views": rbac.effective_views(user)}


@router.post("/logout")
def logout(body: RefreshBody, request: Request):
    authdb.execute(
        "UPDATE dbo.refresh_tokens SET revoked_at=(now() AT TIME ZONE 'utc') WHERE token_hash=%s AND revoked_at IS NULL",
        [security.hash_token(body.refreshToken)],
    )
    log.info("Refresh token revoked (logout)")
    log.activity("User logged out (refresh token revoked)")
    return {"ok": True}


@router.post("/change-password")
def change_password(body: ChangePwBody, request: Request):
    user = rbac.current_user(request)
    row = authdb.fetch_one("SELECT password_hash, must_change_password FROM dbo.users WHERE id=%s", [user["id"]])
    # Skip the current-password check ONLY on the forced first-login flow.
    if not row["must_change_password"]:
        if not body.currentPassword or not security.verify_password(body.currentPassword, row["password_hash"]):
            raise HTTPException(400, "Current password is incorrect")
    if len(body.newPassword) < 8:
        raise HTTPException(400, "New password must be at least 8 characters")
    authdb.execute(
        """UPDATE dbo.users SET password_hash=%s, must_change_password=false,
             version=version+1, updated_at=(now() AT TIME ZONE 'utc') WHERE id=%s""",
        [security.hash_password(body.newPassword), user["id"]],
    )
    # Invalidate all existing refresh tokens on password change...
    authdb.execute("UPDATE dbo.refresh_tokens SET revoked_at=(now() AT TIME ZONE 'utc') WHERE user_id=%s AND revoked_at IS NULL", [user["id"]])
    rbac.audit(user["id"], "PASSWORD_CHANGE", "user", user["id"], None, _client_ip(request))
    log.info(f"Password changed for '{user['username']}' (id={user['id']}); sessions revoked")
    # ...then issue a FRESH session so the caller isn't left holding a revoked
    # refresh token (which would 401 → bounce to /login on the next request).
    fresh = rbac.load_user(user["id"])
    session = _issue_session(fresh, request)
    return {**session, "user": _public_user(fresh), "views": rbac.effective_views(fresh)}
