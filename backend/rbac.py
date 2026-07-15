"""RBAC: identity resolution, hierarchy/level guards, view entitlement, and the
server-side row-level scope injection for the company data endpoints.

Trust boundary: the access token carries role/level, but we re-load the user row
(and their scopes) from the auth DB on every request so deactivation and scope
changes take effect immediately, and a client can NEVER widen its own data scope.
"""
from __future__ import annotations

import json

import jwt
from fastapi import HTTPException, Request

import authdb
import security

SUPER_ADMIN, PRODUCT_HEAD, RENEWAL_HEAD, RENEWAL_TEAM = 1, 2, 3, 4  # role levels (lower = stronger)


# ── Identity ─────────────────────────────────────────────────────────────────
def _bearer(request: Request) -> str:
    h = request.headers.get("authorization") or ""
    if not h.lower().startswith("bearer "):
        raise HTTPException(401, "Missing bearer token")
    return h[7:].strip()


def load_user(user_id: int) -> dict | None:
    row = authdb.fetch_one(
        """SELECT u.id, u.username, u.email, u.full_name, u.role_id, u.parent_id,
                  u.company_user_id, u.is_active, u.must_change_password,
                  r.role_code, r.level
           FROM dbo.users u JOIN dbo.roles r ON r.id = u.role_id
           WHERE u.id = %s""",
        [user_id],
    )
    if not row or not row["is_active"]:
        return None
    scopes = authdb.fetch_all(
        "SELECT scope_type, scope_value FROM dbo.user_scopes WHERE user_id=%s AND is_active",
        [user_id],
    )
    row["scopes"] = {
        "regions": [s["scope_value"] for s in scopes if s["scope_type"] == "REGION"],
        "branches": [s["scope_value"] for s in scopes if s["scope_type"] == "BRANCH"],
        "ams": [int(s["scope_value"]) for s in scopes if s["scope_type"] == "AM"
                and str(s["scope_value"]).lstrip("-").isdigit()],
    }
    return row


def current_user(request: Request) -> dict:
    """FastAPI dependency — the authenticated, still-active user (fresh from DB)."""
    try:
        claims = security.decode_access_token(_bearer(request))
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired token")
    user = load_user(int(claims["sub"]))
    if not user:
        raise HTTPException(401, "User not found or deactivated")
    return user


# ── Hierarchy guard ───────────────────────────────────────────────────────────
def require_level(max_level: int):
    """Dependency: caller's level must be <= max_level (i.e. at least as strong)."""
    def dep(request: Request) -> dict:
        user = current_user(request)
        if user["level"] > max_level:
            raise HTTPException(403, "Insufficient role level")
        return user
    return dep


def is_scoped(user: dict) -> bool:
    """A user is data-scoped if they are Renewal Team, OR any user who has explicit
    scopes assigned. Super Admin / Renewal Head with no scopes see everything."""
    if user["level"] >= RENEWAL_TEAM:
        return True
    s = user["scopes"]
    return bool(s["regions"] or s["branches"] or s["ams"])


# ── View entitlement (design doc §B.5) ─────────────────────────────────────────
def effective_views(user: dict) -> list[dict]:
    return authdb.fetch_all(
        """
        SELECT v.id, v.view_code, v.view_name, v.route, v.icon, v.category,
               v.config, v.sort_order,
               CASE WHEN uva_exp.can_export IS NOT NULL THEN uva_exp.can_export
                    ELSE COALESCE(rva.can_export, false) END AS can_export,
               CASE WHEN uva_exp.can_edit IS NOT NULL THEN uva_exp.can_edit
                    ELSE COALESCE(rva.can_edit, false) END   AS can_edit
        FROM dbo.views v
        LEFT JOIN dbo.role_view_access rva
               ON rva.view_id=v.id AND rva.role_id=%s AND rva.is_active AND rva.can_view
        LEFT JOIN dbo.user_view_access uva_exp
               ON uva_exp.view_id=v.id AND uva_exp.user_id=%s
        WHERE v.is_active
          AND (
                ( rva.id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM dbo.user_view_access uva
                                   WHERE uva.view_id=v.id AND uva.user_id=%s AND uva.is_granted=false) )
             OR EXISTS (SELECT 1 FROM dbo.user_view_access uva
                         WHERE uva.view_id=v.id AND uva.user_id=%s AND uva.is_granted=true)
              )
        ORDER BY v.category, v.sort_order
        """,
        [user["role_id"], user["id"], user["id"], user["id"]],
    )


def require_view(view_code: str, cap: str = "can_view"):
    """Dependency: caller must be entitled to `view_code` (optionally with capability
    'can_export' / 'can_edit'). Returns the user for downstream use."""
    def dep(request: Request) -> dict:
        user = current_user(request)
        match = next((v for v in effective_views(user) if v["view_code"] == view_code), None)
        if not match:
            raise HTTPException(403, f"Not entitled to view {view_code}")
        if cap != "can_view" and not match.get(cap):
            raise HTTPException(403, f"Missing capability {cap} on {view_code}")
        return user
    return dep


# ── Row-level scope injection ──────────────────────────────────────────────────
def apply_scope(f: dict, user: dict) -> dict:
    """Mutate & return the filter dict with the caller's data scope enforced.

    For scoped users we DELETE any client-sent region/branch (they must not be able
    to widen or pivot outside their grant) and inject `_scope`, which build_where
    turns into a fail-closed WHERE predicate.
    """
    if not is_scoped(user):
        return f  # super/admin, global — no restriction
    f.pop("region", None)
    f.pop("branch", None)
    f["_scope"] = {
        "regions": user["scopes"]["regions"],
        "branches": user["scopes"]["branches"],
        "ams": user["scopes"]["ams"],
    }
    return f


def audit(actor_id: int | None, action: str, entity_type: str | None = None,
          entity_id: int | None = None, details: dict | None = None, ip: str | None = None) -> None:
    authdb.execute(
        """INSERT INTO dbo.audit_log (actor_id, action, entity_type, entity_id, details, ip)
           VALUES (%s,%s,%s,%s,%s,%s)""",
        [actor_id, action, entity_type, entity_id,
         json.dumps(details) if details is not None else None, ip],
    )
