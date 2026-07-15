-- ============================================================================
-- 02 — Seed roles, views, role->view defaults, and the super admin
--
-- Port of seed.py's seed_roles_views() + seed_super_admin(). Idempotent
-- (ON CONFLICT DO NOTHING) — safe to run more than once.
--
-- Run (set the bootstrap password on the command line so it isn't stored here):
--   psql "postgresql://USER:PASSWORD@HOST:5432/renewal_auth?sslmode=require" \
--        -v superadmin_password="'ChangeMe_Strong@123'" -f 02_seed.sql
--
-- NOTE the quoting: -v NAME="'value'"  (psql needs the inner single-quotes so the
-- value is a SQL string literal). If you omit -v, the fallback \set below is used
-- — CHANGE IT before running, or better, pass -v.
-- ============================================================================

-- Fallback if not supplied via -v. CHANGE THIS or pass -v superadmin_password="'...'".
\if :{?superadmin_password}
\else
  \set superadmin_password '''Superadmin@123'''
\endif

-- 1. ROLES ------------------------------------------------------------------
INSERT INTO dbo.roles (role_code, role_name, level, description) VALUES
  ('SUPER_ADMIN',   'Super Admin',   1, 'Full control: manages all users, views, and data (only one)'),
  ('PRODUCT_HEAD',  'Product Head',  2, 'Oversees the renewal program: manages renewal heads and their teams'),
  ('RENEWAL_HEAD',  'Renewal Head',  3, 'Manages the renewal team and assigns views within scope'),
  ('RENEWAL_TEAM',  'Renewal Team',  4, 'Dashboards scoped to their region/branch/AM book')
ON CONFLICT (role_code) DO NOTHING;

-- 2. VIEWS (each maps to a real Angular route — drives the sidebar) ---------
INSERT INTO dbo.views (view_code, view_name, route, icon, category, sort_order) VALUES
  ('DASHBOARD',     'Dashboard',     '/',               'grid',  'Analytics',       10),
  ('POLICIES',      'Policies',      '/policies',       'table', 'Analytics',       20),
  ('USER_PROFILES', 'User Profiles', '/admin/profiles', 'users', 'User Management', 80),
  ('USER_MGMT',     'My Account',    '/admin/users',    'user',  'User Management', 90)
ON CONFLICT (view_code) DO NOTHING;

-- 3. ROLE -> VIEW defaults (can_view, can_export, can_edit) ------------------
-- USER_MGMT (My Account) is available to everyone; USER_PROFILES (manage others) is admin+.
INSERT INTO dbo.role_view_access (role_id, view_id, can_view, can_export, can_edit)
SELECT r.id, v.id, x.can_view, x.can_export, x.can_edit
FROM (VALUES
    ('SUPER_ADMIN',  'DASHBOARD',     true,  true,  true),
    ('SUPER_ADMIN',  'POLICIES',      true,  true,  true),
    ('SUPER_ADMIN',  'USER_PROFILES', true,  true,  true),
    ('SUPER_ADMIN',  'USER_MGMT',     true,  true,  true),
    ('PRODUCT_HEAD', 'DASHBOARD',     true,  true,  false),
    ('PRODUCT_HEAD', 'POLICIES',      true,  true,  false),
    ('PRODUCT_HEAD', 'USER_PROFILES', true,  false, true),
    ('PRODUCT_HEAD', 'USER_MGMT',     true,  false, false),
    ('RENEWAL_HEAD', 'DASHBOARD',     true,  true,  false),
    ('RENEWAL_HEAD', 'POLICIES',      true,  true,  false),
    ('RENEWAL_HEAD', 'USER_PROFILES', true,  false, true),
    ('RENEWAL_HEAD', 'USER_MGMT',     true,  false, false),
    ('RENEWAL_TEAM', 'DASHBOARD',     true,  false, false),
    ('RENEWAL_TEAM', 'POLICIES',      true,  true,  false),
    ('RENEWAL_TEAM', 'USER_MGMT',     true,  false, false)
) AS x(role_code, view_code, can_view, can_export, can_edit)
JOIN dbo.roles r ON r.role_code = x.role_code
JOIN dbo.views v ON v.view_code = x.view_code
ON CONFLICT (role_id, view_id) DO NOTHING;


-- 4. SUPER ADMIN ------------------------------------------------------------
-- Password is bcrypt-hashed IN SQL via pgcrypto: crypt(pw, gen_salt('bf', 12))
-- produces a standard $2a$12$ hash that the app's Python bcrypt verifies.
-- must_change_password = true forces a change on first login (as seed.py did).
INSERT INTO dbo.users (username, full_name, password_hash, role_id, must_change_password)
SELECT 'superadmin', 'Super Admin',
       crypt(:superadmin_password, gen_salt('bf', 12)),
       r.id, true
FROM dbo.roles r
WHERE r.role_code = 'SUPER_ADMIN'
ON CONFLICT (username) DO NOTHING;

-- Report what exists now.
SELECT r.role_code, r.level, count(u.id) AS users
FROM dbo.roles r LEFT JOIN dbo.users u ON u.role_id = r.id
GROUP BY r.role_code, r.level ORDER BY r.level;
