-- ============================================================================
-- 03 — Reset the super admin password (Postgres equivalent of the reset we ran
--       on the Docker MSSQL earlier)
--
-- What we did on MSSQL was: bcrypt-hash a new password and UPDATE dbo.users,
-- clearing lockout / failed attempts. This does the same, in pure SQL, using
-- pgcrypto for the bcrypt hash.
--
-- Run (pass the new password on the command line, don't hardcode it):
--   psql "postgresql://USER:PASSWORD@HOST:5432/renewal_auth?sslmode=require" \
--        -v new_password="'MyNew@Password123'" -f 03_reset_superadmin.sql
-- ============================================================================

\if :{?new_password}
\else
  \echo '>>> ERROR: pass -v new_password="''YourNewPassword''"'
  \quit 1
\endif

UPDATE dbo.users
SET password_hash         = crypt(:new_password, gen_salt('bf', 12)),
    must_change_password  = false,   -- set true if you want a forced change on next login
    failed_login_attempts = 0,
    locked_until          = NULL,
    is_active             = true,
    version               = version + 1,
    updated_at            = (now() AT TIME ZONE 'utc')
WHERE username = 'superadmin'
  AND role_id  = (SELECT id FROM dbo.roles WHERE role_code = 'SUPER_ADMIN');

-- Verify: crypt(candidate, stored_hash) = stored_hash  ->  true means it matches
-- (this is exactly what the app's bcrypt.checkpw does).
SELECT username,
       (password_hash = crypt(:new_password, password_hash)) AS password_matches,
       is_active, failed_login_attempts, locked_until, must_change_password
FROM dbo.users
WHERE username = 'superadmin';
