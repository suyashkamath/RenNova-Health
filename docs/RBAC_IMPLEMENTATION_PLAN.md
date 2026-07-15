# RBAC & Configurable Views — Implementation Plan (Renewal Dashboard)

> Adapts the design doc (`Auth + RBAC + Views`) to **this** stack: FastAPI + Angular +
> MSSQL, company data read-only over the SSH tunnel, auth data in a **new MSSQL auth DB**.
>
> **Confirmed decisions**
> 1. **Scope unit:** Region **and** Branch — a head may own regions and/or branches.
> 2. **Auth DB host:** MSSQL, same server, in `USERS_DATABASE` (reuse the tunnel; new pool).
> 3. **View authoring:** Super Admin owns the catalog; Admins only *assign* existing views.
> 4. **Roles:** `SUPER_ADMIN` (level 1) → `ADMIN` (2) → `REGIONAL_HEAD` (3).

---

## 0. What already exists (and why this is ~60% wiring, not greenfield)

| Doc concept | Already in this repo | Gap to close |
|---|---|---|
| Company DB, read-only, pooled, over tunnel | `db.py` pool (autocommit, all SELECT) → `probus_autoboat_live` | none — reuse as-is |
| Region/Branch scoping predicate | `queries.py:249-254` — `user_id IN (SELECT UserId FROM vw_master_user WHERE RegionName/BranchName = %s)` | extend single-value → `IN (...)` for multi-scope |
| "Regions" catalog | `SELECT DISTINCT RegionName/BranchName FROM vw_master_user` | seed auth-DB tables from this |
| "Views" catalog | Angular routes: `/dashboard`, `/policies`, `/entity`, `/calendar` (`app.routes.ts`) | make them DB rows; add admin views |
| Auth DB home | `USERS_DATABASE` reserved in `.env` (declared, **unused in code today**) | create schema + a second pool |
| Authentication | **nothing — every endpoint is public, CORS `*`** | build from scratch |

**The linchpin:** a Regional Head's data scope is just a forced injection of `region`/`branch`
into the filter dict *before* `build_where` runs. The SQL to enforce it already exists.

---

## 1. Auth database — MSSQL DDL (translated from doc §B.4)

Lives in `USERS_DATABASE` on the same server. All tables in `dbo`. Postgres → T-SQL:
`BIGINT IDENTITY(1,1)`, `BIT`, `DATETIME2` + `SYSUTCDATETIME()` (UTC), `NVARCHAR(MAX)` +
`CHECK(ISJSON(...)=1)` for JSON, `VARCHAR(45)` for IP, filtered indexes for partials.

```sql
-- 1. ROLES ---------------------------------------------------------------
CREATE TABLE dbo.roles (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    role_code   VARCHAR(50)   NOT NULL UNIQUE,   -- SUPER_ADMIN | ADMIN | REGIONAL_HEAD
    role_name   NVARCHAR(100) NOT NULL,
    level       INT           NOT NULL,          -- 1=super, 2=admin, 3=regional head
    description NVARCHAR(400),
    is_active   BIT           NOT NULL DEFAULT 1,
    created_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);

-- 2. USERS (auth accounts — ours, never the company's) -------------------
CREATE TABLE dbo.users (
    id                    BIGINT IDENTITY(1,1) PRIMARY KEY,
    username              NVARCHAR(100) NOT NULL UNIQUE,
    email                 NVARCHAR(255) UNIQUE,
    full_name             NVARCHAR(200),
    password_hash         NVARCHAR(255) NOT NULL,          -- bcrypt; compared in app
    role_id               BIGINT        NOT NULL REFERENCES dbo.roles(id),
    parent_id             BIGINT        REFERENCES dbo.users(id),  -- creator/owner; NULL for super
    company_user_id       BIGINT,                          -- OPTIONAL link to vw_master_user.UserId (NO hard FK)
    is_active             BIT           NOT NULL DEFAULT 1,
    must_change_password  BIT           NOT NULL DEFAULT 1,
    failed_login_attempts INT           NOT NULL DEFAULT 0,
    locked_until          DATETIME2,
    last_login_at         DATETIME2,
    created_by            BIGINT        REFERENCES dbo.users(id),
    updated_by            BIGINT        REFERENCES dbo.users(id),
    created_at            DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at            DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    [version]             INT           NOT NULL DEFAULT 1,   -- optimistic locking
    CONSTRAINT chk_no_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX idx_users_role   ON dbo.users(role_id);
CREATE INDEX idx_users_parent ON dbo.users(parent_id) WHERE parent_id IS NOT NULL;

-- 3. USER SCOPES (generalizes doc's user_regions to REGION *and* BRANCH) --
-- Decision #1: a head may own any mix of regions and branches. scope_value
-- holds the literal RegionName / BranchName from vw_master_user (region_code == RegionName).
CREATE TABLE dbo.user_scopes (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    user_id     BIGINT       NOT NULL REFERENCES dbo.users(id),
    scope_type  VARCHAR(10)  NOT NULL CHECK (scope_type IN ('REGION','BRANCH')),
    scope_value NVARCHAR(150) NOT NULL,          -- e.g. 'West', 'Pune-2'
    is_active   BIT          NOT NULL DEFAULT 1,
    created_by  BIGINT       REFERENCES dbo.users(id),
    created_at  DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT uq_user_scope UNIQUE (user_id, scope_type, scope_value)
);

-- 4. VIEWS (dashboard view catalog) --------------------------------------
CREATE TABLE dbo.views (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    view_code   VARCHAR(80)   NOT NULL UNIQUE,   -- DASHBOARD, POLICIES, ENTITY, CALENDAR, USER_MGMT, AUDIT_LOG
    view_name   NVARCHAR(150) NOT NULL,
    description NVARCHAR(400),
    route       NVARCHAR(200) NOT NULL,          -- Angular path, e.g. /dashboard
    icon        NVARCHAR(80),
    category    NVARCHAR(80),
    config      NVARCHAR(MAX) NOT NULL DEFAULT '{}' CHECK (ISJSON(config)=1),
    sort_order  INT           NOT NULL DEFAULT 0,
    is_active   BIT           NOT NULL DEFAULT 1,
    created_by  BIGINT        REFERENCES dbo.users(id),
    created_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);

-- 5. ROLE → VIEW defaults ------------------------------------------------
CREATE TABLE dbo.role_view_access (
    id         BIGINT IDENTITY(1,1) PRIMARY KEY,
    role_id    BIGINT NOT NULL REFERENCES dbo.roles(id),
    view_id    BIGINT NOT NULL REFERENCES dbo.views(id),
    can_view   BIT    NOT NULL DEFAULT 1,
    can_export BIT    NOT NULL DEFAULT 0,
    can_edit   BIT    NOT NULL DEFAULT 0,
    is_active  BIT    NOT NULL DEFAULT 1,
    created_by BIGINT REFERENCES dbo.users(id),
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT uq_role_view UNIQUE (role_id, view_id)
);

-- 6. USER → VIEW override (how Super Admin tailors one user) --------------
CREATE TABLE dbo.user_view_access (
    id         BIGINT IDENTITY(1,1) PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES dbo.users(id),
    view_id    BIGINT NOT NULL REFERENCES dbo.views(id),
    is_granted BIT    NOT NULL,                 -- 1 = extra grant, 0 = explicit revoke
    can_export BIT,                             -- NULL = inherit from role
    can_edit   BIT,
    created_by BIGINT REFERENCES dbo.users(id),
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT uq_user_view UNIQUE (user_id, view_id)
);

-- 7. REFRESH TOKENS (store only the SHA-256 hash) ------------------------
CREATE TABLE dbo.refresh_tokens (
    id         BIGINT IDENTITY(1,1) PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES dbo.users(id),
    token_hash CHAR(64) NOT NULL,               -- sha256 hex; NEVER the raw token
    expires_at DATETIME2 NOT NULL,
    revoked_at DATETIME2,
    user_agent NVARCHAR(400),
    ip         VARCHAR(45),
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX idx_refresh_user ON dbo.refresh_tokens(user_id);
CREATE INDEX idx_refresh_hash ON dbo.refresh_tokens(token_hash);

-- 8. AUDIT LOG -----------------------------------------------------------
CREATE TABLE dbo.audit_log (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    actor_id    BIGINT REFERENCES dbo.users(id),
    action      VARCHAR(80) NOT NULL,           -- LOGIN, USER_CREATE, VIEW_ASSIGN, SCOPE_ASSIGN, ...
    entity_type VARCHAR(80),
    entity_id   BIGINT,
    details     NVARCHAR(MAX) CHECK (details IS NULL OR ISJSON(details)=1),
    ip          VARCHAR(45),
    created_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
```

### Seed (one-off script, never an API — doc §A.6 / §B.13)
1. Insert the 3 roles.
2. Insert the 6 views (4 existing pages + `USER_MGMT`, `AUDIT_LOG`).
3. Insert `role_view_access` defaults: SUPER_ADMIN → all; ADMIN → all data views + USER_MGMT;
   REGIONAL_HEAD → DASHBOARD/POLICIES/ENTITY/CALENDAR (read-only, no export by default).
4. Insert one `SUPER_ADMIN` user with a bcrypt-hashed bootstrap password + `must_change_password=1`.
5. **Regions/branches are NOT stored** as a fixed catalog — they're read live from
   `vw_master_user` for the assignment dropdown, so they never drift from company data.
   (`user_scopes.scope_value` stores the chosen literal.)

---

## 2. Backend — new files & responsibilities

```
backend/
  authdb.py      NEW  second pool → USERS_DATABASE (writes allowed; own pool so the
                      company pool stays conceptually read-only). Same _Pool class,
                      database=USERS_DATABASE.
  security.py    NEW  bcrypt (passlib), JWT encode/decode (pyjwt, HS256 pinned),
                      sha256 for refresh tokens, secret loaded fail-closed from env.
  auth.py        NEW  APIRouter: /auth/login,/refresh,/logout,/change-password.
                      Lockout counter, must_change_password flow.
  rbac.py        NEW  FastAPI dependencies:
                        - current_user()  -> decode + validate JWT
                        - require_level(n) -> hierarchy guard (level <= n)
                        - require_view(code, cap) -> entitlement check (resolution §B.5)
                        - apply_scope(f, user) -> inject region/branch scope into filter
  management.py  NEW  APIRouter: /users, /views, /roles/{id}/views,
                      /users/{id}/views, /users/{id}/scopes, /me, /me/views, /audit
  main.py        EDIT include routers; add Depends(current_user) to data endpoints;
                      call apply_scope() before build_where; lock CORS to real origin.
  queries.py     EDIT build_where: region/branch accept a LIST -> `... IN (%s,%s,..)`.
                      Add scope_where(regions, branches) helper (single subquery, OR'd).
  requirements.txt EDIT add: pyjwt, passlib[bcrypt], python-multipart
```

### Scope injection (the security-critical part)
`REGIONAL_HEAD` scope must **override**, never merely default — a client can already send
`?region=` today. In `apply_scope`:
- SUPER_ADMIN / ADMIN (global): no injection (or their own scopes if assigned).
- REGIONAL_HEAD: **delete** any client-sent `region`/`branch`, then inject the user's
  `user_scopes` as a combined predicate:
  ```sql
  user_id IN (SELECT UserId FROM vw_master_user
              WHERE RegionName IN (:regions) OR BranchName IN (:branches))
  ```
  A head with zero scopes sees **nothing** (fail-closed), not everything.

### Auth mechanics (doc §B.7 / §B.11 — all supported in FastAPI)
- bcrypt cost 12; compared in app, never SQL.
- Access JWT HS256, 30–60 min, claims `{sub, username, role, level, scopes, ver}`.
- Refresh token: 32 random bytes, store **sha256 only**, rotate on use, revoke on logout.
- Secret from env — **`main.py` refuses to boot if `JWT_SECRET` unset** (no fallback).
- JWT decode pins `algorithms=["HS256"]` (rejects `alg:none`/RS256 confusion).
- Lockout: 5 fails → `locked_until = now + 30 min`.
- Change-password skips current-password check **only** when `must_change_password=1`
  AND the request carries a valid session (never an anonymous username endpoint).

---

## 3. Frontend (Angular) — changes

```
frontend/src/app/
  services/auth.service.ts      NEW  login/logout, token storage, current user + views
  core/auth.interceptor.ts      NEW  attach Bearer; on 401 try refresh, else -> /login
  core/auth.guard.ts            NEW  route guard: authed + entitled to the view_code
  pages/login/                  NEW  login form + forced first-login password change
  pages/admin/                  NEW  user management, view assignment, scope assignment
  app.routes.ts                 EDIT guard existing routes; add /login, /admin/*
  app.config.ts                 EDIT register the interceptor
  (sidebar/shell)               EDIT build nav from GET /me/views, not hardcoded links
```
Frontend is **advisory only** — it hides views it isn't entitled to, but the backend
re-checks entitlement + scope on every `/api/*` call. Never trust the client.

---

## 4. Retrofit checklist for existing endpoints

Each currently-public endpoint in `main.py`:

| Endpoint | Add auth | Scope-inject | Entitlement (view) |
|---|---|---|---|
| `/api/dashboard` | ✅ | ✅ region/branch | `DASHBOARD` view |
| `/api/policies` | ✅ | ✅ | `POLICIES` |
| `/api/policies/export` | ✅ | ✅ | `POLICIES` + `can_export` |
| `/api/filters` | ✅ | ✅ (dropdowns must not leak out-of-scope values) | any data view |
| `/api/trend` | ✅ | ✅ | `DASHBOARD` |
| `/api/calendar` | ✅ | ✅ | `CALENDAR` |
| `/api/health` | keep public (liveness) | — | — |

> Note `/api/filters`: for a scoped head, the Region/Branch/RM/POSP dropdowns must be
> filtered to their scope too, or the UI leaks the existence of other regions.

---

## 5. Phased delivery

- **Phase 1 — Schema & seed.** DDL migration + seed script into `USERS_DATABASE`. Verify
  `SUPER_ADMIN` row + role/view defaults exist. *(No app behavior change yet.)*
- **Phase 2 — Auth core.** `authdb.py`, `security.py`, `auth.py`. Login → JWT works via
  curl. Lockout + change-password. Boot-fails-without-secret.
- **Phase 3 — RBAC deps + retrofit.** `rbac.py`; protect + scope-inject the 6 data
  endpoints; extend `build_where` for multi-scope. Verify a head sees only their rows.
- **Phase 4 — Management APIs.** `management.py`: users (subtree-scoped), view assignment,
  scope assignment, `/me/views`, audit. DB-level guards mirror API guards.
- **Phase 5 — Frontend.** Login page, interceptor, guard, dynamic sidebar, admin screens.
- **Phase 6 — Hardening.** CORS locked to real origin; security checklist (doc §B.11)
  walked end-to-end; audit-log coverage confirmed.

Each phase is independently testable and leaves the app runnable.

---

## 6. Risks / decisions still open

1. **CORS `*` → must become the real frontend origin** before production (Bearer tokens
   work with `*`, but it's needlessly permissive).
2. **One DB login for both databases.** The doc wants a least-privilege read-only company
   user; today `MSSQL_USER` serves both company (read) and auth (write). Acceptable to
   ship, but note it — ideally a separate write-capable login for `USERS_DATABASE`.
3. **`vw_master_user` availability.** Scope resolution depends on it every request; if the
   tunnel drops, scoped queries fail. `/api/health` and login should degrade gracefully
   (doc §B.9): auth stays up, data endpoints return 503.
4. **Region/branch naming stability.** `scope_value` stores literal names; if the company
   renames a region, existing scopes silently stop matching. Acceptable for v1; revisit if
   they churn.
5. **Admin data scope** — assumed global. If Admins should also be region-limited, reuse
   `user_scopes` for them too (design already supports it).
```
