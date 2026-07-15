# RBAC & Auth — Setup & Operations

Authentication + role-based access + row-level data scoping for the Renewal Dashboard.
Built per `RBAC_IMPLEMENTATION_PLAN.md`. This doc is how to **run and operate** it.

## Architecture (as built)

- **Company DB** (`probus_autoboat_live` + `probus_web_live.vw_master_user`) — READ-ONLY
  over the SSH tunnel. Unchanged. The `ai_dev` account cannot create tables there.
- **Auth DB** (`renewal_auth`) — a SEPARATE, writable SQL Server we control (locally a
  dockerized `azure-sql-edge`). Holds users, roles, scopes, views, tokens, audit.
- **Identity source**: login accounts are seeded FROM the company directory
  (`vw_master_user`, `RoleId=13` = employees). Passwords are OURS (company passwords
  are not visible). Each employee is scoped to their **own AM book** (`am_id`).

## Roles

| Role | level | Sees | Can create |
|------|:----:|------|-----------|
| `SUPER_ADMIN` | 1 | everything | ADMIN, REGIONAL_HEAD |
| `ADMIN` | 2 | everything (or assigned scopes) | REGIONAL_HEAD |
| `REGIONAL_HEAD` | 3 | only their scope (AM / region / branch) | — |

Row scope is **fail-closed**: a scoped user with no scopes sees nothing. Scope is injected
server-side and **overrides** any client-sent `region`/`branch` (no scope-widening).

## First-time setup

```bash
# 1. Local auth DB (Apple Silicon friendly)
docker run -d --name rbac-mssql -e ACCEPT_EULA=1 -e MSSQL_SA_PASSWORD='Rbac_Dev_2026!' \
  -p 11433:1433 mcr.microsoft.com/azure-sql-edge:latest

# 2. Python deps
cd backend && pip install -r requirements.txt

# 3. Fill AUTH_* in backend/.env (already set for local dev). For prod, generate:
#    openssl rand -hex 32   -> AUTH_JWT_SECRET

# 4. Create schema + seed roles/views/super-admin (NO users are auto-created)
python seed.py --all
#   --schema      create DB + tables
#   --seed        roles, views, role->view defaults, super admin
#   --employees   OPTIONAL, EXPLICIT ONLY: bulk-import all active RoleId=13 employees.
#                 Not part of --all. Normally you create users manually in the admin UI.

# 5. Run
uvicorn main:app --port 3000 --reload      # backend (fails to boot if AUTH_JWT_SECRET unset)
cd ../frontend && npm start                # Angular on :4200
```

Login as `superadmin` / `AUTH_BOOTSTRAP_PASSWORD` → forced to set a new password →
land on the dashboard. Employees log in with `username = LoginId`, `password = LoginId`
(forced change on first login).

## Day-2 ops

- **Restart auth DB**: `docker start rbac-mssql`
- **Promote someone to Regional Head**: in Admin → Users, set role + add REGION/BRANCH
  scopes (or `PUT /api/users/{id}/scopes`).
- **Reset a password**: Admin → Users → Reset PW (issues a one-time temp password).
- **Add a dashboard view**: Super Admin only (`POST /api/views`), then set role defaults
  (`PUT /api/roles/{id}/views`). The sidebar rebuilds from `/api/me/views`.

## Security posture (verified)

- bcrypt (cost 12); JWT HS256 with **algorithm pinned** on decode (rejects `alg:none`).
- App **refuses to boot** without a ≥32-char `AUTH_JWT_SECRET`.
- Refresh tokens rotated on use; only their SHA-256 hash is stored; revoked on
  logout / password change / deactivation.
- Account lockout: 5 failures → locked 30 min.
- Every `/api/*` data endpoint re-checks view entitlement AND injects the caller's
  row scope server-side. `/api/health` stays public.
- CORS locked to `AUTH_CORS_ORIGINS`.

## Key files

```
backend/auth_schema.sql   MSSQL DDL (idempotent)
backend/authdb.py         writable auth-DB pool + helpers
backend/security.py       bcrypt + JWT + refresh hashing
backend/seed.py           schema/seed/employee-import CLI
backend/auth_routes.py    /api/auth/{login,refresh,logout,change-password}
backend/rbac.py           current_user, require_level, require_view, apply_scope
backend/management.py     /api/{me,users,views,roles,regions,audit}
backend/queries.py        build_where extended with _scope injection
frontend/src/app/services/auth.service.ts
frontend/src/app/core/{auth.interceptor,auth.guard}.ts
frontend/src/app/pages/login/login.ts
frontend/src/app/pages/admin/users.ts
```
