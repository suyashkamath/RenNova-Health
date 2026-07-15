-- 04 — Rename roles to the renewal-org naming (July 2026)
--   ADMIN         -> RENEWAL_HEAD  "Renewal Head"
--   REGIONAL_HEAD -> RENEWAL_TEAM  "Renewal Team"
-- Levels, ids, user assignments and role_view_access rows are untouched
-- (everything references roles.id). Idempotent.

UPDATE dbo.roles
SET role_code = 'RENEWAL_HEAD',
    role_name = 'Renewal Head',
    description = 'Manages the renewal team and assigns views within scope'
WHERE role_code = 'ADMIN';

UPDATE dbo.roles
SET role_code = 'RENEWAL_TEAM',
    role_name = 'Renewal Team',
    description = 'Dashboards scoped to their region/branch/AM book'
WHERE role_code = 'REGIONAL_HEAD';

UPDATE dbo.roles
SET description = 'Product head — full control: manages renewal heads, views, and all data'
WHERE role_code = 'SUPER_ADMIN';
