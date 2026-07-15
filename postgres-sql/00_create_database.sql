-- ============================================================================
-- 00 — Create the auth database (run ONCE, connected to the default "postgres" db)
--
-- On managed Postgres (AWS RDS / GCP Cloud SQL) you may already have been given a
-- database — if so, SKIP this file and just run 01_schema.sql against that database.
--
--   psql "postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=require" -f 00_create_database.sql
--
-- CREATE DATABASE cannot run inside a transaction, so run it on its own.
-- ============================================================================

CREATE DATABASE renewal_auth;

-- After this: connect to renewal_auth and run 01_schema.sql, then 02_seed.sql.
