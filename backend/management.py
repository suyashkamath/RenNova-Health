"""Management API: profile, users, views catalog, view assignment, scopes, regions, audit.

Hierarchy rules (enforced here; mirror them in the DB later for defense-in-depth):
- A caller may only create/edit users STRICTLY BELOW their own level.
- Admins are limited to their own subtree (descendants via parent_id); Super Admin is global.
- Only Super Admin edits the view catalog and role->view defaults (Decision: SA owns catalog).
"""
from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

import authdb
import logger as log
import queries as q
import rbac
import security
from db import get_connection

router = APIRouter(prefix="/api", tags=["management"])


# ── Me ─────────────────────────────────────────────────────────────────────
@router.get("/me")
def me(user: dict = Depends(rbac.current_user)):
    from auth_routes import _public_user
    return _public_user(user)


@router.get("/me/views")
def my_views(user: dict = Depends(rbac.current_user)):
    return {"views": rbac.effective_views(user)}


ORG_NAME = "Probus Insurance Broker Ltd"


@router.get("/me/account")
def my_account(user: dict = Depends(rbac.current_user)):
    """Profile + demographics for the 'My Account' page. Demographics come from the
    read-only company directory (vw_master_user) joined on company_user_id; fields the
    directory doesn't carry (gender/age/states) come back as None (dashed in the UI)."""
    row = authdb.fetch_one(
        """SELECT username, full_name, email, is_active, last_login_at, company_user_id,
                  (SELECT role_code FROM dbo.roles r WHERE r.id=u.role_id) role
           FROM dbo.users u WHERE id=%s""",
        [user["id"]],
    )
    demo = {"gender": None, "age": None, "branch": None, "division": None,
            "region": None, "zone": None, "states": None, "jobRole": row["role"]}
    if row.get("company_user_id"):
        conn = get_connection()
        try:
            cur = conn.cursor(as_dict=True)
            cur.execute(
                """SELECT TOP 1 BranchName, DivisonName, RegionName, ZoneName, UserType
                   FROM probus_web_live.dbo.vw_master_user WHERE UserId=%s""",
                [row["company_user_id"]],
            )
            m = cur.fetchone()
            if m:
                demo.update(branch=m["BranchName"], division=m["DivisonName"],
                            region=m["RegionName"], zone=m["ZoneName"], jobRole=m["UserType"])
        finally:
            conn.close()
    return {
        "org": ORG_NAME,
        "profile": {
            "username": row["username"], "fullName": row["full_name"], "email": row["email"],
            "role": row["role"], "isActive": bool(row["is_active"]), "lastLoginAt": row["last_login_at"],
        },
        "demographics": demo,
    }


# ── Users ────────────────────────────────────────────────────────────────────
def _subtree_ids(user: dict) -> list[int] | None:
    """IDs the caller may manage. None == unrestricted (Super Admin)."""
    if user["level"] <= rbac.SUPER_ADMIN:
        return None
    rows = authdb.fetch_all(
        """WITH RECURSIVE tree AS (
             SELECT id FROM dbo.users WHERE parent_id=%s
             UNION ALL
             SELECT u.id FROM dbo.users u JOIN tree t ON u.parent_id=t.id
           ) SELECT id FROM tree""",
        [user["id"]],
    )
    return [r["id"] for r in rows]


class CreateUserBody(BaseModel):
    username: str
    fullName: str | None = None
    email: str | None = None
    roleCode: str
    companyUserId: int | None = None
    managerId: int | None = None          # parent_id; defaults to the creator
    password: str | None = None           # explicit password (ignored if generateTempPassword)
    generateTempPassword: bool = True


def _directory_meta(company_ids: list[int]) -> dict[int, dict]:
    """Batch-fetch mobile/branch/region for a set of company_user_ids (POSP/AM UserIds)."""
    ids = [i for i in company_ids if i]
    if not ids:
        return {}
    conn = get_connection()
    try:
        cur = conn.cursor(as_dict=True)
        ph = q._ph(ids)
        cur.execute(
            f"""SELECT UserId, MobileNumber, BranchName, RegionName
                FROM probus_web_live.dbo.vw_master_user WHERE UserId IN ({ph})""", ids)
        return {r["UserId"]: r for r in cur.fetchall()}
    finally:
        conn.close()


@router.get("/directory/search")
def directory_search(q_: str = "", user: dict = Depends(rbac.require_level(rbac.RENEWAL_HEAD))):
    """Search the READ-ONLY company directory (vw_master_user) by LoginId / mobile / name,
    for the Add-Profile picker. Returns candidates to link a new login to."""
    term = (q_ or "").strip()
    if len(term) < 2:
        return []
    like = f"%{term}%"
    conn = get_connection()
    try:
        cur = conn.cursor(as_dict=True)
        cur.execute(
            """SELECT TOP 20 UserId, LoginId, UserFullName, MobileNumber, EmailAddress,
                      BranchName, RegionName, UserType, AM_Id
               FROM probus_web_live.dbo.vw_master_user
               WHERE IsActive=1 AND IsDelete=0
                 AND (LoginId LIKE %s OR MobileNumber LIKE %s OR UserFullName LIKE %s)
               ORDER BY UserFullName""",
            [like, like, like],
        )
        return [{
            "companyUserId": r["UserId"], "loginId": r["LoginId"], "fullName": r["UserFullName"],
            "mobile": r["MobileNumber"], "email": r["EmailAddress"], "branch": r["BranchName"],
            "region": r["RegionName"], "userType": r["UserType"], "amId": r["AM_Id"],
        } for r in cur.fetchall()]
    finally:
        conn.close()


@router.get("/managers")
def managers(user: dict = Depends(rbac.require_level(rbac.RENEWAL_HEAD))):
    """Active users who can be a new profile's manager (parent). Scoped to the caller's
    subtree (+ self for admins); global for super admin."""
    subtree = _subtree_ids(user)
    rows = authdb.fetch_all(
        """SELECT u.id, u.username, u.full_name, r.role_code
           FROM dbo.users u JOIN dbo.roles r ON r.id=u.role_id WHERE u.is_active""")
    allowed = None if subtree is None else set(subtree) | {user["id"]}
    return [r for r in rows if allowed is None or r["id"] in allowed]


class UpdateUserBody(BaseModel):
    fullName: str | None = None
    email: str | None = None
    isActive: bool | None = None
    roleCode: str | None = None           # new role; must be strictly below the caller's level


@router.get("/users")
def list_users(request: Request, user: dict = Depends(rbac.require_level(rbac.RENEWAL_HEAD))):
    subtree = _subtree_ids(user)
    sql = """SELECT u.id, u.username, u.email, u.full_name, r.role_code, r.level,
                    u.is_active, u.must_change_password, u.locked_until, u.last_login_at,
                    u.company_user_id, u.parent_id, p.username AS manager_username
             FROM dbo.users u JOIN dbo.roles r ON r.id=u.role_id
             LEFT JOIN dbo.users p ON p.id=u.parent_id"""
    if subtree is None:
        rows = authdb.fetch_all(sql + " ORDER BY u.id")
    elif not subtree:
        return []
    else:
        rows = authdb.fetch_all(sql + f" WHERE u.id IN ({q._ph(subtree)}) ORDER BY u.id", subtree)
    # Enrich with mobile/branch from the company directory (batched, one query).
    meta = _directory_meta([r["company_user_id"] for r in rows])
    for r in rows:
        m = meta.get(r["company_user_id"]) or {}
        r["mobile"] = m.get("MobileNumber")
        r["branch"] = m.get("BranchName")
    return rows


@router.post("/users")
def create_user(body: CreateUserBody, request: Request,
                user: dict = Depends(rbac.require_level(rbac.RENEWAL_HEAD))):
    role = authdb.fetch_one("SELECT id, level FROM dbo.roles WHERE role_code=%s AND is_active", [body.roleCode])
    if not role:
        raise HTTPException(400, "Unknown role")
    if role["level"] <= user["level"]:
        raise HTTPException(403, "You can only create users strictly below your level")
    if authdb.fetch_one("SELECT id FROM dbo.users WHERE username=%s", [body.username]):
        raise HTTPException(409, "Username already exists")

    # Manager (parent): default to the creator; if provided, it must be a user the
    # caller manages (or the caller themselves).
    parent_id = user["id"]
    if body.managerId is not None:
        subtree = _subtree_ids(user)
        if subtree is not None and body.managerId != user["id"] and body.managerId not in subtree:
            raise HTTPException(403, "Chosen manager is not in your subtree")
        if not authdb.fetch_one("SELECT id FROM dbo.users WHERE id=%s AND is_active", [body.managerId]):
            raise HTTPException(400, "Manager not found")
        parent_id = body.managerId

    # Password: generate a temp (revealed once) unless an explicit one is given.
    if body.generateTempPassword or not body.password:
        temp = secrets.token_urlsafe(9)
        secret_pw = temp
    else:
        if len(body.password) < 8:
            raise HTTPException(400, "Password must be at least 8 characters")
        secret_pw, temp = body.password, None
    must_change = True  # always force a change on first login

    uid = authdb.insert_returning_id(
        """INSERT INTO dbo.users (username, full_name, email, password_hash, role_id,
             parent_id, company_user_id, must_change_password, created_by)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        [body.username, body.fullName, body.email, security.hash_password(secret_pw),
         role["id"], parent_id, body.companyUserId, must_change, user["id"]],
    )
    rbac.audit(user["id"], "USER_CREATE", "user", uid, {"role": body.roleCode, "manager": parent_id},
               request.client.host if request.client else None)
    log.info(f"User '{body.username}' (id={uid}, role={body.roleCode}) created by '{user['username']}'")
    # Only reveal a password we generated (the temp). An admin-set one is not echoed back.
    return {"id": uid, "tempPassword": temp}


def _assert_manageable(user: dict, target_id: int) -> None:
    subtree = _subtree_ids(user)
    if subtree is not None and target_id not in subtree:
        raise HTTPException(403, "User not in your subtree")


def _assert_can_set_password(user: dict, target_id: int) -> dict:
    """A caller may reset a subordinate's password only when the target is (a) in the
    caller's manageable subtree AND (b) STRICTLY BELOW the caller's role level. The level
    check is defense-in-depth: it stops an Admin resetting a peer Admin or a Super Admin
    even if the parent_id tree were ever mis-wired, and stops a Super Admin resetting
    another Super Admin. Renewal Team users never reach here (guarded by require_level(RENEWAL_HEAD))."""
    _assert_manageable(user, target_id)
    target = authdb.fetch_one(
        "SELECT u.id, u.username, r.level FROM dbo.users u JOIN dbo.roles r ON r.id=u.role_id WHERE u.id=%s",
        [target_id],
    )
    if not target:
        raise HTTPException(404, "User not found")
    if target["level"] <= user["level"]:
        raise HTTPException(403, "You can only reset the password of users below your role level")
    return target


@router.put("/users/{target_id}")
def update_user(target_id: int, body: UpdateUserBody, request: Request,
                user: dict = Depends(rbac.require_level(rbac.RENEWAL_HEAD))):
    _assert_manageable(user, target_id)
    sets, params = [], []
    if body.fullName is not None:
        sets.append("full_name=%s"); params.append(body.fullName)
    if body.email is not None:
        sets.append("email=%s"); params.append(body.email)
    if body.isActive is not None:
        sets.append("is_active=%s"); params.append(bool(body.isActive))
    role_changed = None
    if body.roleCode is not None:
        target = authdb.fetch_one(
            "SELECT u.id, r.role_code, r.level FROM dbo.users u JOIN dbo.roles r ON r.id=u.role_id WHERE u.id=%s",
            [target_id])
        if not target:
            raise HTTPException(404, "User not found")
        if target["level"] <= user["level"]:
            raise HTTPException(403, "You can only change the role of users below your level")
        role = authdb.fetch_one("SELECT id, level FROM dbo.roles WHERE role_code=%s AND is_active", [body.roleCode])
        if not role:
            raise HTTPException(400, "Unknown role")
        if role["level"] <= user["level"]:
            raise HTTPException(403, "You can only assign roles strictly below your level")
        if body.roleCode != target["role_code"]:
            sets.append("role_id=%s"); params.append(role["id"])
            role_changed = {"from": target["role_code"], "to": body.roleCode}
    if not sets:
        return {"ok": True}
    params.append(target_id)
    authdb.execute(f"UPDATE dbo.users SET {', '.join(sets)}, version=version+1, updated_at=(now() AT TIME ZONE 'utc') WHERE id=%s", params)
    if role_changed:
        rbac.audit(user["id"], "USER_ROLE_CHANGE", "user", target_id, role_changed,
                   request.client.host if request.client else None)
    log.info(f"User id={target_id} updated by '{user['username']}'"
             + (f" (role {role_changed['from']} -> {role_changed['to']})" if role_changed else ""))
    return {"ok": True}


@router.post("/users/{target_id}/deactivate")
def deactivate_user(target_id: int, request: Request, user: dict = Depends(rbac.require_level(rbac.RENEWAL_HEAD))):
    _assert_manageable(user, target_id)
    authdb.execute("UPDATE dbo.users SET is_active=false, updated_at=(now() AT TIME ZONE 'utc') WHERE id=%s", [target_id])
    authdb.execute("UPDATE dbo.refresh_tokens SET revoked_at=(now() AT TIME ZONE 'utc') WHERE user_id=%s AND revoked_at IS NULL", [target_id])
    rbac.audit(user["id"], "USER_DEACTIVATE", "user", target_id, None, request.client.host if request.client else None)
    log.info(f"User id={target_id} deactivated by '{user['username']}'; sessions revoked")
    return {"ok": True}


class ResetPasswordBody(BaseModel):
    password: str | None = None             # explicit new password; omit/blank to generate a temp
    mustChangePassword: bool | None = None  # force change on next login
                                            # (default: True for a temp, False for an explicit password)


@router.post("/users/{target_id}/reset-password")
def reset_password(target_id: int, request: Request, body: ResetPasswordBody | None = None,
                   user: dict = Depends(rbac.require_level(rbac.RENEWAL_HEAD))):
    """Super Admin / Admin resets a SUBORDINATE's password. The target must be in the
    caller's subtree AND strictly below their role level (see _assert_can_set_password).
    Renewal Team users cannot call this (blocked by require_level(RENEWAL_HEAD))."""
    body = body or ResetPasswordBody()
    _assert_can_set_password(user, target_id)

    if body.password:
        secret_pw = body.password
        if len(secret_pw) < 8:
            raise HTTPException(400, "Password must be at least 8 characters")
        if len(secret_pw.encode("utf-8")) > 72:
            raise HTTPException(400, "Password too long (max 72 bytes)")
        temp = None
        must_change = bool(body.mustChangePassword)
    else:
        # No explicit password → generate a one-time temp; force a change unless told not to.
        secret_pw = temp = secrets.token_urlsafe(9)
        must_change = body.mustChangePassword is not False

    authdb.execute(
        """UPDATE dbo.users SET password_hash=%s, must_change_password=%s, failed_login_attempts=0,
             locked_until=NULL, version=version+1, updated_at=(now() AT TIME ZONE 'utc') WHERE id=%s""",
        [security.hash_password(secret_pw), must_change, target_id],
    )
    # Force the subordinate to re-authenticate everywhere (mirrors /auth/change-password).
    authdb.execute("UPDATE dbo.refresh_tokens SET revoked_at=(now() AT TIME ZONE 'utc') WHERE user_id=%s AND revoked_at IS NULL", [target_id])
    rbac.audit(user["id"], "PASSWORD_RESET", "user", target_id,
               {"mode": "explicit" if temp is None else "temp", "mustChange": bool(must_change)},
               request.client.host if request.client else None)
    log.info(f"Password reset for user id={target_id} by '{user['username']}' "
             f"(mode={'explicit' if temp is None else 'temp'})")
    # tempPassword is null when the caller set an explicit password (nothing to reveal).
    return {"tempPassword": temp}


@router.post("/users/{target_id}/unlock")
def unlock_user(target_id: int, user: dict = Depends(rbac.require_level(rbac.RENEWAL_HEAD))):
    _assert_manageable(user, target_id)
    authdb.execute("UPDATE dbo.users SET failed_login_attempts=0, locked_until=NULL WHERE id=%s", [target_id])
    return {"ok": True}


# ── View catalog (Super Admin only) ───────────────────────────────────────────
class ViewBody(BaseModel):
    viewCode: str
    viewName: str
    route: str
    icon: str | None = None
    category: str | None = None
    config: str = "{}"
    sortOrder: int = 0


@router.get("/views")
def list_views(user: dict = Depends(rbac.current_user)):
    return authdb.fetch_all("SELECT * FROM dbo.views WHERE is_active ORDER BY category, sort_order")


@router.post("/views")
def create_view(body: ViewBody, user: dict = Depends(rbac.require_level(rbac.SUPER_ADMIN))):
    if authdb.fetch_one("SELECT id FROM dbo.views WHERE view_code=%s", [body.viewCode]):
        raise HTTPException(409, "view_code exists")
    vid = authdb.insert_returning_id(
        """INSERT INTO dbo.views (view_code, view_name, route, icon, category, config, sort_order, created_by)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
        [body.viewCode, body.viewName, body.route, body.icon, body.category, body.config, body.sortOrder, user["id"]],
    )
    return {"id": vid}


@router.post("/views/{view_id}/deactivate")
def deactivate_view(view_id: int, user: dict = Depends(rbac.require_level(rbac.SUPER_ADMIN))):
    authdb.execute("UPDATE dbo.views SET is_active=false, updated_at=(now() AT TIME ZONE 'utc') WHERE id=%s", [view_id])
    return {"ok": True}


# ── Role -> view defaults (Super Admin) ────────────────────────────────────────
class RoleViewsBody(BaseModel):
    views: list[dict]  # [{viewCode, canView, canExport, canEdit}]


@router.get("/roles")
def list_roles(user: dict = Depends(rbac.require_level(rbac.RENEWAL_HEAD))):
    return authdb.fetch_all("SELECT id, role_code, role_name, level FROM dbo.roles WHERE is_active ORDER BY level")


@router.get("/roles/{role_id}/views")
def role_views(role_id: int, user: dict = Depends(rbac.require_level(rbac.RENEWAL_HEAD))):
    return authdb.fetch_all(
        """SELECT v.view_code, v.view_name, COALESCE(rva.can_view,false) can_view,
                  COALESCE(rva.can_export,false) can_export, COALESCE(rva.can_edit,false) can_edit
           FROM dbo.views v
           LEFT JOIN dbo.role_view_access rva ON rva.view_id=v.id AND rva.role_id=%s AND rva.is_active
           WHERE v.is_active ORDER BY v.category, v.sort_order""",
        [role_id],
    )


@router.put("/roles/{role_id}/views")
def set_role_views(role_id: int, body: RoleViewsBody, request: Request,
                   user: dict = Depends(rbac.require_level(rbac.SUPER_ADMIN))):
    view_ids = {v["view_code"]: v["id"] for v in authdb.fetch_all("SELECT id, view_code FROM dbo.views")}
    for item in body.views:
        vid = view_ids.get(item["viewCode"])
        if not vid:
            continue
        cv = bool(item.get("canView"))
        ce = bool(item.get("canExport"))
        cd = bool(item.get("canEdit"))
        if authdb.fetch_one("SELECT id FROM dbo.role_view_access WHERE role_id=%s AND view_id=%s", [role_id, vid]):
            authdb.execute(
                "UPDATE dbo.role_view_access SET can_view=%s, can_export=%s, can_edit=%s, is_active=true WHERE role_id=%s AND view_id=%s",
                [cv, ce, cd, role_id, vid])
        else:
            authdb.execute(
                "INSERT INTO dbo.role_view_access (role_id, view_id, can_view, can_export, can_edit, created_by) VALUES (%s,%s,%s,%s,%s,%s)",
                [role_id, vid, cv, ce, cd, user["id"]])
    rbac.audit(user["id"], "ROLE_VIEWS_SET", "role", role_id, None, request.client.host if request.client else None)
    log.info(f"Role id={role_id} view defaults updated by '{user['username']}'")
    return {"ok": True}


# ── Per-user view overrides ────────────────────────────────────────────────────
class UserViewsBody(BaseModel):
    grant: list[str] = []
    revoke: list[str] = []


@router.get("/users/{target_id}/views")
def get_user_views(target_id: int, user: dict = Depends(rbac.require_level(rbac.RENEWAL_HEAD))):
    _assert_manageable(user, target_id)
    target = rbac.load_user(target_id)
    if not target:
        raise HTTPException(404, "User not found")
    return {"effective": rbac.effective_views(target),
            "overrides": authdb.fetch_all(
                """SELECT v.view_code, uva.is_granted FROM dbo.user_view_access uva
                   JOIN dbo.views v ON v.id=uva.view_id WHERE uva.user_id=%s""", [target_id])}


@router.put("/users/{target_id}/views")
def set_user_views(target_id: int, body: UserViewsBody, request: Request,
                   user: dict = Depends(rbac.require_level(rbac.RENEWAL_HEAD))):
    _assert_manageable(user, target_id)
    view_ids = {v["view_code"]: v["id"] for v in authdb.fetch_all("SELECT id, view_code FROM dbo.views")}
    for code, granted in [(c, True) for c in body.grant] + [(c, False) for c in body.revoke]:
        vid = view_ids.get(code)
        if not vid:
            continue
        if authdb.fetch_one("SELECT id FROM dbo.user_view_access WHERE user_id=%s AND view_id=%s", [target_id, vid]):
            authdb.execute("UPDATE dbo.user_view_access SET is_granted=%s WHERE user_id=%s AND view_id=%s", [granted, target_id, vid])
        else:
            authdb.execute("INSERT INTO dbo.user_view_access (user_id, view_id, is_granted, created_by) VALUES (%s,%s,%s,%s)", [target_id, vid, granted, user["id"]])
    rbac.audit(user["id"], "USER_VIEWS_SET", "user", target_id, {"grant": body.grant, "revoke": body.revoke}, request.client.host if request.client else None)
    log.info(f"View overrides set for user id={target_id} by '{user['username']}' "
             f"(grant={body.grant}, revoke={body.revoke})")
    return {"ok": True}


# ── Scopes (region/branch/AM) ──────────────────────────────────────────────────
class ScopesBody(BaseModel):
    scopes: list[dict]  # [{scopeType: REGION|BRANCH|AM, scopeValue: str}]


@router.get("/users/{target_id}/scopes")
def get_scopes(target_id: int, user: dict = Depends(rbac.require_level(rbac.RENEWAL_HEAD))):
    _assert_manageable(user, target_id)
    return authdb.fetch_all("SELECT scope_type, scope_value FROM dbo.user_scopes WHERE user_id=%s AND is_active", [target_id])


@router.put("/users/{target_id}/scopes")
def set_scopes(target_id: int, body: ScopesBody, request: Request, user: dict = Depends(rbac.require_level(rbac.RENEWAL_HEAD))):
    _assert_manageable(user, target_id)
    authdb.execute("DELETE FROM dbo.user_scopes WHERE user_id=%s", [target_id])
    for s in body.scopes:
        st = (s.get("scopeType") or "").upper()
        sv = str(s.get("scopeValue") or "").strip()
        if st not in ("REGION", "BRANCH", "AM") or not sv:
            continue
        authdb.execute("INSERT INTO dbo.user_scopes (user_id, scope_type, scope_value, created_by) VALUES (%s,%s,%s,%s)", [target_id, st, sv, user["id"]])
    rbac.audit(user["id"], "SCOPE_ASSIGN", "user", target_id, {"scopes": body.scopes}, request.client.host if request.client else None)
    log.info(f"Data scopes set for user id={target_id} by '{user['username']}' "
             f"({len(body.scopes)} scope(s))")
    return {"ok": True}


# ── Regions/branches (read from company directory, for assignment dropdowns) ────
@router.get("/regions")
def regions(user: dict = Depends(rbac.require_level(rbac.RENEWAL_HEAD))):
    conn = get_connection()
    try:
        cur = conn.cursor(as_dict=True)
        return {"regions": q.distinct_master(cur, "RegionName"), "branches": q.distinct_branches(cur)}
    finally:
        conn.close()


# ── Audit ──────────────────────────────────────────────────────────────────────
@router.get("/audit")
def audit_log(user: dict = Depends(rbac.require_level(rbac.RENEWAL_HEAD)), limit: int = 200):
    limit = max(1, min(1000, limit))
    return authdb.fetch_all(
        f"""SELECT a.id, a.action, a.entity_type, a.entity_id, a.details, a.ip,
                   a.created_at, u.username actor
            FROM dbo.audit_log a LEFT JOIN dbo.users u ON u.id=a.actor_id
            ORDER BY a.created_at DESC LIMIT {limit}""")
