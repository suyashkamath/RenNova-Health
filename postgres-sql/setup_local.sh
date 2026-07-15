#!/usr/bin/env bash
# ============================================================================
# Local Postgres setup for the Renewal Dashboard AUTH DB.
#
# Creates the `renewal_auth` database (if needed), applies the schema, and seeds
# roles/views/access + the super admin — all against your LOCAL Postgres.
#
# Usage (from the repo root or anywhere):
#   PGPASSWORD=your_pg_password bash postgres-sql/setup_local.sh
#
# Optional overrides (env vars):
#   PGHOST      (default 127.0.0.1)
#   PGPORT      (default 5432)
#   PGUSER      (default postgres)          -- a superuser, to CREATE DATABASE
#   AUTH_DB     (default renewal_auth)
#   SA_PASSWORD (default Superadmin@123)     -- the super admin's initial password
# ============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGGSSENCMODE="${PGGSSENCMODE:-disable}"   # skip GSSAPI so we go straight to password auth
AUTH_DB="${AUTH_DB:-renewal_auth}"
SA_PASSWORD="${SA_PASSWORD:-Superadmin@123}"

if [ -z "${PGPASSWORD:-}" ]; then
  echo "ERROR: set PGPASSWORD, e.g.  PGPASSWORD=yourpw bash postgres-sql/setup_local.sh" >&2
  exit 1
fi

echo "==> Postgres: $PGUSER@$PGHOST:$PGPORT   auth db: $AUTH_DB"

# 1. Create the database if it does not exist (connect to the default 'postgres' db).
if psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${AUTH_DB}'" | grep -q 1; then
  echo "==> database '${AUTH_DB}' already exists — skipping create"
else
  echo "==> creating database '${AUTH_DB}'"
  psql -d postgres -c "CREATE DATABASE \"${AUTH_DB}\""
fi

# 2. Schema (idempotent).
echo "==> applying schema (01_schema.sql)"
psql -d "${AUTH_DB}" -v ON_ERROR_STOP=1 -f "${HERE}/01_schema.sql"

# 3. Seed roles/views/access + super admin (idempotent).
echo "==> seeding (02_seed.sql)  super admin password = '${SA_PASSWORD}'"
psql -d "${AUTH_DB}" -v ON_ERROR_STOP=1 -v superadmin_password="'${SA_PASSWORD}'" -f "${HERE}/02_seed.sql"

# 4. Quick verify: super admin exists and the password matches (crypt check).
echo "==> verifying super admin"
psql -d "${AUTH_DB}" -tA -v pw="'${SA_PASSWORD}'" -c \
  "SELECT 'superadmin ok, password_matches=' || (password_hash = crypt(:pw, password_hash))::text
     FROM dbo.users WHERE username='superadmin';"

echo "==> DONE. Connect with:"
echo "    psql \"postgresql://${PGUSER}@${PGHOST}:${PGPORT}/${AUTH_DB}\""
