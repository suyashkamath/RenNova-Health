"""Bootstrap the AUTH database.

Usage (from backend/):
    python seed.py --schema            # create DB (if needed) + tables
    python seed.py --seed              # roles, views, role->view defaults, super admin
    python seed.py --employees         # import active RoleId=13 employees from vw_master_user
    python seed.py --all               # all of the above

Requires AUTH_JWT_SECRET and AUTH_BOOTSTRAP_PASSWORD in backend/.env (the latter only
for --seed). Employees are imported with a TEMP password = their LoginId and
must_change_password=1, scoped to their own AM book + Region + Branch.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path

import authdb
import security
from db import get_connection  # read-only company connection (for employee import)

HERE = Path(__file__).resolve().parent

ROLES = [
    ("SUPER_ADMIN", "Super Admin", 1, "Full control: manages all users, views, and data (only one)"),
    ("PRODUCT_HEAD", "Product Head", 2, "Oversees the renewal program: manages renewal heads and their teams"),
    ("RENEWAL_HEAD", "Renewal Head", 3, "Manages the renewal team and assigns views within scope"),
    ("RENEWAL_TEAM", "Renewal Team", 4, "Dashboards scoped to their region/branch/AM book"),
]

VIEWS = [
    # code, name, route, icon, category, sort
    # NB: each view here MUST map to a real Angular route (it drives the sidebar).
    # Calendar is a widget inside the dashboard, so it is NOT a separate view — the
    # /api/calendar endpoint is gated by the DASHBOARD entitlement. The audit log is
    # a level-gated endpoint (no dedicated page yet), so it is not a view either.
    ("DASHBOARD", "Dashboard", "/", "grid", "Analytics", 10),
    ("POLICIES", "Policies", "/policies", "table", "Analytics", 20),
    ("USER_PROFILES", "User Profiles", "/admin/profiles", "users", "User Management", 80),
    ("USER_MGMT", "My Account", "/admin/users", "user", "User Management", 90),
]

# role_code -> {view_code: (can_view, can_export, can_edit)}
# USER_MGMT (My Account) is available to everyone; USER_PROFILES (manage others) is admin+.
DEFAULT_ACCESS = {
    "SUPER_ADMIN": {v[0]: (1, 1, 1) for v in VIEWS},
    "PRODUCT_HEAD": {"DASHBOARD": (1, 1, 0), "POLICIES": (1, 1, 0), "USER_PROFILES": (1, 0, 1), "USER_MGMT": (1, 0, 0)},
    "RENEWAL_HEAD": {"DASHBOARD": (1, 1, 0), "POLICIES": (1, 1, 0), "USER_PROFILES": (1, 0, 1), "USER_MGMT": (1, 0, 0)},
    "RENEWAL_TEAM": {"DASHBOARD": (1, 0, 0), "POLICIES": (1, 1, 0), "USER_MGMT": (1, 0, 0)},
}


def create_database() -> None:
    db = authdb.auth_database()
    conn = authdb.raw_connect(dbname="postgres")  # maintenance db (autocommit)
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 AS x FROM pg_database WHERE datname=%s", (db,))
        if cur.fetchone():
            print(f"  database {db!r} already exists")
        else:
            cur.execute(f'CREATE DATABASE "{db}"')
            print(f"  created database {db!r}")
    finally:
        conn.close()


def create_schema() -> None:
    # Apply the Postgres schema. Run statement-by-statement (psycopg's extended
    # protocol executes one command per call); the schema has no functions/dollar
    # quotes, so splitting on ';' is safe.
    sql = (HERE.parent / "postgres-sql" / "01_schema.sql").read_text()
    conn = authdb.raw_connect()
    try:
        cur = conn.cursor()
        for stmt in (s.strip() for s in sql.split(";")):
            # skip blank/comment-only chunks
            if not stmt or all(ln.strip().startswith("--") or not ln.strip()
                               for ln in stmt.splitlines()):
                continue
            cur.execute(stmt)
    finally:
        conn.close()
    print("  schema applied (postgres-sql/01_schema.sql)")


def seed_roles_views() -> None:
    for code, name, level, desc in ROLES:
        if not authdb.fetch_one("SELECT id FROM dbo.roles WHERE role_code=%s", [code]):
            authdb.execute(
                "INSERT INTO dbo.roles (role_code, role_name, [level], description) VALUES (%s,%s,%s,%s)",
                [code, name, level, desc],
            )
    print(f"  roles: {len(ROLES)}")

    for code, name, route, icon, cat, sort in VIEWS:
        if not authdb.fetch_one("SELECT id FROM dbo.views WHERE view_code=%s", [code]):
            authdb.execute(
                """INSERT INTO dbo.views (view_code, view_name, route, icon, category, sort_order)
                   VALUES (%s,%s,%s,%s,%s,%s)""",
                [code, name, route, icon, cat, sort],
            )
    print(f"  views: {len(VIEWS)}")

    role_ids = {r["role_code"]: r["id"] for r in authdb.fetch_all("SELECT id, role_code FROM dbo.roles")}
    view_ids = {v["view_code"]: v["id"] for v in authdb.fetch_all("SELECT id, view_code FROM dbo.views")}
    n = 0
    for role_code, grants in DEFAULT_ACCESS.items():
        for view_code, (cv, ce, cd) in grants.items():
            rid, vid = role_ids[role_code], view_ids[view_code]
            if not authdb.fetch_one(
                "SELECT id FROM dbo.role_view_access WHERE role_id=%s AND view_id=%s", [rid, vid]
            ):
                authdb.execute(
                    """INSERT INTO dbo.role_view_access (role_id, view_id, can_view, can_export, can_edit)
                       VALUES (%s,%s,%s,%s,%s)""",
                    [rid, vid, bool(cv), bool(ce), bool(cd)],
                )
                n += 1
    print(f"  role->view defaults: {n} inserted")


def seed_super_admin() -> None:
    username = os.environ.get("AUTH_BOOTSTRAP_USER") or "superadmin"
    password = os.environ.get("AUTH_BOOTSTRAP_PASSWORD")
    if not password:
        raise SystemExit("AUTH_BOOTSTRAP_PASSWORD must be set in .env to seed the super admin")
    if authdb.fetch_one("SELECT id FROM dbo.users WHERE username=%s", [username]):
        print(f"  super admin {username!r} already exists")
        return
    role = authdb.fetch_one("SELECT id FROM dbo.roles WHERE role_code='SUPER_ADMIN'")
    authdb.execute(
        """INSERT INTO dbo.users (username, full_name, password_hash, role_id, must_change_password)
           VALUES (%s,%s,%s,%s,true)""",
        [username, "Super Admin", security.hash_password(password), role["id"]],
    )
    print(f"  super admin created: {username!r} (must change password on first login)")


def import_employees() -> None:
    """Pull active RoleId=13 employees from the company directory and create login
    accounts scoped to their own AM book + Region + Branch. Idempotent by username."""
    rh = authdb.fetch_one("SELECT id FROM dbo.roles WHERE role_code='RENEWAL_TEAM'")
    sa = authdb.fetch_one("SELECT id FROM dbo.users WHERE role_id=(SELECT id FROM dbo.roles WHERE role_code='SUPER_ADMIN') ORDER BY id")
    parent_id = sa["id"] if sa else None

    conn = get_connection()
    try:
        cur = conn.cursor(as_dict=True)
        cur.execute(
            """SELECT UserId, LoginId, EmailAddress, UserFullName, RegionName, BranchName, AM_Id
               FROM probus_web_live.dbo.vw_master_user
               WHERE RoleId=13 AND IsActive=1 AND IsDelete=0
                 AND LoginId IS NOT NULL AND LoginId<>''"""
        )
        emps = cur.fetchall()
    finally:
        conn.close()

    created = skipped = 0
    for e in emps:
        username = e["LoginId"].strip()
        if authdb.fetch_one("SELECT id FROM dbo.users WHERE username=%s", [username]):
            skipped += 1
            continue
        uid = authdb.insert_returning_id(
            """INSERT INTO dbo.users (username, email, full_name, password_hash, role_id,
                 parent_id, company_user_id, must_change_password)
               VALUES (%s,%s,%s,%s,%s,%s,%s,true)""",
            [username, (e["EmailAddress"] or None), (e["UserFullName"] or None),
             security.hash_password(username),  # TEMP password = LoginId; forced change on first login
             rh["id"], parent_id, e["UserId"]],
        )
        # Imported AccountManagers are scoped to THEIR OWN BOOK (am_id) — they see the
        # renewals they manage, not their whole region. Region/branch scopes are for
        # users an admin later widens via /users/{id}/scopes.
        if e["AM_Id"] is not None and str(e["AM_Id"]).strip():
            authdb.execute(
                """INSERT INTO dbo.user_scopes (user_id, scope_type, scope_value, created_by)
                   VALUES (%s,'AM',%s,%s)""",
                [uid, str(e["AM_Id"]).strip(), parent_id],
            )
        created += 1
    print(f"  employees: {created} created, {skipped} already existed (of {len(emps)} active)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--schema", action="store_true")
    ap.add_argument("--seed", action="store_true")
    ap.add_argument("--employees", action="store_true")
    ap.add_argument("--all", action="store_true")
    a = ap.parse_args()
    if not any([a.schema, a.seed, a.employees, a.all]):
        ap.error("pick at least one: --schema --seed --employees --all")

    print(f"Auth DB: {authdb.auth_database()}")
    if a.schema or a.all:
        print("[schema]"); create_database(); create_schema()
    if a.seed or a.all:
        print("[seed]"); seed_roles_views(); seed_super_admin()
    # Employee bulk-import is EXPLICIT ONLY (never part of --all). Users are created
    # manually via the admin UI / POST /api/users. Run `python seed.py --employees`
    # only if you deliberately want to pre-load all active RoleId=13 employees.
    if a.employees:
        print("[employees]"); import_employees()
    print("Done.")


if __name__ == "__main__":
    main()
