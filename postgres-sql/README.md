# postgres-sql — AUTH DB on PostgreSQL

Everything needed to build the Renewal Dashboard **auth database** (users, roles,
scopes, views, tokens, audit) on PostgreSQL — locally now, and on your remote
Postgres later. This is the Postgres port of `backend/auth_schema.sql` +
`backend/seed.py`, plus the password-reset command we ran earlier on the MSSQL container.

> The **company/renewal data** (`probus_autoboat_live`) stays on the remote MSSQL,
> read-only, over the SSH tunnel. It is **not** part of this and does not move.

## Files (run in order)

| File | What it does | Equivalent of |
|------|--------------|---------------|
| `00_create_database.sql` | `CREATE DATABASE renewal_auth` (skip if your managed DB is pre-made) | `seed.py --schema` (db create) |
| `01_schema.sql` | Schema `dbo` + all tables/indexes + `pgcrypto` | `auth_schema.sql` |
| `02_seed.sql` | Roles, views, role→view defaults, super admin | `seed.py --seed` |
| `03_reset_superadmin.sql` | Reset the super admin password | the bcrypt reset we ran on MSSQL |
| `setup_local.sh` | One-shot: create + schema + seed + verify, against local Postgres | all of the above |

## Local setup (fastest — one command)

You already have PostgreSQL 17 running on `localhost:5432`. From the repo root:

```bash
PGPASSWORD=your_local_pg_password bash postgres-sql/setup_local.sh
```

Optional overrides: `PGUSER` (default `postgres`), `AUTH_DB` (default `renewal_auth`),
`SA_PASSWORD` (default `Superadmin@123`). The script is idempotent — safe to re-run.

It prints `password_matches=true` at the end when the super admin seeded correctly.

## Manual / remote setup (run the files yourself)

```bash
# 1. create the DB (connect to the default 'postgres' database first)
psql "postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=require" -f 00_create_database.sql

# 2. schema + seed (against the auth DB). Pass the super admin password with -v.
psql "postgresql://USER:PASSWORD@HOST:5432/renewal_auth?sslmode=require" -v ON_ERROR_STOP=1 -f 01_schema.sql
psql "postgresql://USER:PASSWORD@HOST:5432/renewal_auth?sslmode=require" -v ON_ERROR_STOP=1 \
     -v superadmin_password="'ChangeMe_Strong@123'" -f 02_seed.sql
```

> On AWS RDS / GCP Cloud SQL: keep `sslmode=require`, and `pgcrypto` is an allowed
> `CREATE EXTENSION` (01_schema.sql enables it).

## Resetting the super admin password later

```bash
psql "postgresql://USER:PASSWORD@HOST:5432/renewal_auth?sslmode=require" \
     -v new_password="'MyNew@Password123'" -f 03_reset_superadmin.sql
```

Prints `password_matches = t` when the new password is stored correctly.

## Backend config (when the app points at Postgres)

Local `.env`:

```
AUTH_DATABASE_URL=postgresql://postgres:PASSWORD@127.0.0.1:5432/renewal_auth
```

Remote `.env` (use SSL + a secret store, don't commit it):

```
AUTH_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/renewal_auth?sslmode=require
```

Keep the existing `MSSQL_*` vars — those are for the read-only company data.

## ⚠️ Still required: the backend driver port

These SQL files build the database. They do **not** by themselves make the app talk
to Postgres — `backend/authdb.py` and the auth SQL are still written for MSSQL
(`pymssql`, `SYSUTCDATETIME()`, `SCOPE_IDENTITY()`, `[brackets]`, `TOP`, `ISNULL`,
recursive CTE). Porting that (driver → `psycopg`, dialect fixes) is the separate
code step. Ask Claude to do it when you're ready to switch the app over.

### Notes
- The `dbo` schema is intentional (Postgres default is `public`) so the app's
  `dbo.<table>` queries keep working unchanged.
- The super admin password is bcrypt-hashed in SQL via `pgcrypto`
  (`crypt(pw, gen_salt('bf', 12))`) — a standard `$2a$` hash the app's Python
  `bcrypt` verifies. No Python needed to seed.
- If your editor flags syntax errors in the `.sql` files, it's linting them as
  MSSQL/T-SQL. They are PostgreSQL/`psql` scripts — ignore those warnings.
