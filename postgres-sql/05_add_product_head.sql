-- 05 — Insert the PRODUCT_HEAD role between Super Admin and Renewal Head (July 2026)
-- New hierarchy: SUPER_ADMIN(1) > PRODUCT_HEAD(2) > RENEWAL_HEAD(3) > RENEWAL_TEAM(4).
-- Existing user->role assignments are untouched (they reference roles.id). Idempotent.

UPDATE dbo.roles SET level = 4 WHERE role_code = 'RENEWAL_TEAM' AND level <> 4;

UPDATE dbo.roles SET level = 3 WHERE role_code = 'RENEWAL_HEAD' AND level <> 3;

UPDATE dbo.roles SET description = 'Full control: manages all users, views, and data (only one)' WHERE role_code = 'SUPER_ADMIN';

INSERT INTO dbo.roles (role_code, role_name, level, description) VALUES ('PRODUCT_HEAD', 'Product Head', 2, 'Oversees the renewal program: manages renewal heads and their teams') ON CONFLICT (role_code) DO NOTHING;

INSERT INTO dbo.role_view_access (role_id, view_id, can_view, can_export, can_edit) SELECT r.id, v.id, x.can_view, x.can_export, x.can_edit FROM (VALUES ('DASHBOARD', true, true, false), ('POLICIES', true, true, false), ('USER_PROFILES', true, false, true), ('USER_MGMT', true, false, false)) AS x(view_code, can_view, can_export, can_edit) JOIN dbo.views v ON v.view_code = x.view_code JOIN dbo.roles r ON r.role_code = 'PRODUCT_HEAD' ON CONFLICT (role_id, view_id) DO NOTHING;
