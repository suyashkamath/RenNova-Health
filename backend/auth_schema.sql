-- ============================================================================
-- Renewal Dashboard — AUTH DB schema (MSSQL / T-SQL)
--
-- Lives in a SEPARATE, WRITABLE SQL Server that WE control (NOT the company
-- server — ai_dev is read-only there and cannot CREATE TABLE). Point the
-- backend at it via AUTH_MSSQL_* env vars (see .env.example). Business/renewal
-- data stays read-only in probus_autoboat_live over the tunnel.
--
-- Idempotent: safe to run repeatedly. Run via `python -m seed --schema`.
-- ============================================================================

-- 1. ROLES ------------------------------------------------------------------
IF OBJECT_ID('dbo.roles') IS NULL
CREATE TABLE dbo.roles (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    role_code   VARCHAR(50)   NOT NULL UNIQUE,     -- SUPER_ADMIN | PRODUCT_HEAD | RENEWAL_HEAD | RENEWAL_TEAM
    role_name   NVARCHAR(100) NOT NULL,
    level       INT           NOT NULL,            -- 1=super, 2=admin, 3=regional head (lower=stronger)
    description NVARCHAR(400),
    is_active   BIT           NOT NULL DEFAULT 1,
    created_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);

-- 2. USERS (auth accounts — ours, seeded FROM the company directory) --------
IF OBJECT_ID('dbo.users') IS NULL
CREATE TABLE dbo.users (
    id                    BIGINT IDENTITY(1,1) PRIMARY KEY,
    username              NVARCHAR(100) NOT NULL UNIQUE,   -- company LoginId (e.g. P625131)
    email                 NVARCHAR(255),
    full_name             NVARCHAR(200),
    password_hash         NVARCHAR(255) NOT NULL,          -- bcrypt; compared in app
    role_id               BIGINT        NOT NULL REFERENCES dbo.roles(id),
    parent_id             BIGINT        REFERENCES dbo.users(id),  -- creator/owner; NULL for super
    company_user_id       BIGINT,                          -- vw_master_user.UserId (NO hard FK — cross-DB)
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
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_users_role')
    CREATE INDEX idx_users_role ON dbo.users(role_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_users_parent')
    CREATE INDEX idx_users_parent ON dbo.users(parent_id) WHERE parent_id IS NOT NULL;

-- 3. USER SCOPES (REGION / BRANCH / AM) -------------------------------------
-- A scoped user sees only rows matching ANY active scope. AM scope_value holds
-- the company AM_Id (== renewal am_id); REGION/BRANCH hold RegionName/BranchName.
IF OBJECT_ID('dbo.user_scopes') IS NULL
CREATE TABLE dbo.user_scopes (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    user_id     BIGINT        NOT NULL REFERENCES dbo.users(id),
    scope_type  VARCHAR(10)   NOT NULL CHECK (scope_type IN ('REGION','BRANCH','AM')),
    scope_value NVARCHAR(150) NOT NULL,
    is_active   BIT           NOT NULL DEFAULT 1,
    created_by  BIGINT        REFERENCES dbo.users(id),
    created_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT uq_user_scope UNIQUE (user_id, scope_type, scope_value)
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_scope_user')
    CREATE INDEX idx_scope_user ON dbo.user_scopes(user_id);

-- 4. VIEWS (dashboard view catalog) -----------------------------------------
IF OBJECT_ID('dbo.views') IS NULL
CREATE TABLE dbo.views (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    view_code   VARCHAR(80)   NOT NULL UNIQUE,     -- DASHBOARD, POLICIES, ENTITY, CALENDAR, USER_MGMT, AUDIT_LOG
    view_name   NVARCHAR(150) NOT NULL,
    description NVARCHAR(400),
    route       NVARCHAR(200) NOT NULL,            -- Angular path, e.g. /dashboard
    icon        NVARCHAR(80),
    category    NVARCHAR(80),
    config      NVARCHAR(MAX) NOT NULL DEFAULT '{}',
    sort_order  INT           NOT NULL DEFAULT 0,
    is_active   BIT           NOT NULL DEFAULT 1,
    created_by  BIGINT        REFERENCES dbo.users(id),
    created_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT chk_views_config_json CHECK (ISJSON(config)=1)
);

-- 5. ROLE -> VIEW defaults --------------------------------------------------
IF OBJECT_ID('dbo.role_view_access') IS NULL
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

-- 6. USER -> VIEW override (grant/revoke per user) --------------------------
IF OBJECT_ID('dbo.user_view_access') IS NULL
CREATE TABLE dbo.user_view_access (
    id         BIGINT IDENTITY(1,1) PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES dbo.users(id),
    view_id    BIGINT NOT NULL REFERENCES dbo.views(id),
    is_granted BIT    NOT NULL,                    -- 1 = extra grant, 0 = explicit revoke
    can_export BIT,                                -- NULL = inherit from role
    can_edit   BIT,
    created_by BIGINT REFERENCES dbo.users(id),
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT uq_user_view UNIQUE (user_id, view_id)
);

-- 7. REFRESH TOKENS (store only the SHA-256 hash) ---------------------------
IF OBJECT_ID('dbo.refresh_tokens') IS NULL
CREATE TABLE dbo.refresh_tokens (
    id         BIGINT IDENTITY(1,1) PRIMARY KEY,
    user_id    BIGINT   NOT NULL REFERENCES dbo.users(id),
    token_hash CHAR(64) NOT NULL,                  -- sha256 hex; NEVER the raw token
    expires_at DATETIME2 NOT NULL,
    revoked_at DATETIME2,
    user_agent NVARCHAR(400),
    ip         VARCHAR(45),
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_refresh_hash')
    CREATE INDEX idx_refresh_hash ON dbo.refresh_tokens(token_hash);

-- 8. AUDIT LOG --------------------------------------------------------------
IF OBJECT_ID('dbo.audit_log') IS NULL
CREATE TABLE dbo.audit_log (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    actor_id    BIGINT REFERENCES dbo.users(id),
    action      VARCHAR(80) NOT NULL,              -- LOGIN, USER_CREATE, VIEW_ASSIGN, SCOPE_ASSIGN, ...
    entity_type VARCHAR(80),
    entity_id   BIGINT,
    details     NVARCHAR(MAX),
    ip          VARCHAR(45),
    created_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_audit_created')
    CREATE INDEX idx_audit_created ON dbo.audit_log(created_at DESC);
