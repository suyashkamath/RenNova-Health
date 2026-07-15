"""Connection pool + helpers for the AUTH database (users/roles/views/tokens).

This is a SEPARATE, WRITABLE PostgreSQL server that we control — NOT the company
server (the company data lives in MSSQL, read-only, reached via db.py over the
tunnel). Configure this one with AUTH_DATABASE_URL (or the discrete AUTH_PG_* /
standard PG* env vars) in backend/.env.

Ported from pymssql/MSSQL to psycopg3 + psycopg_pool. The tables live in a `dbo`
schema (created by postgres-sql/01_schema.sql) so the app's `dbo.<table>` queries
work unchanged.
"""
from __future__ import annotations

import atexit
import os
from contextlib import contextmanager
from pathlib import Path

import psycopg
from psycopg.conninfo import make_conninfo
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from dotenv import load_dotenv

import logger as log

load_dotenv(Path(__file__).resolve().parent / ".env")


def _conninfo(dbname: str | None = None) -> str:
    """Build a libpq conninfo string. AUTH_DATABASE_URL wins; otherwise assemble
    from AUTH_PG_* (then standard PG*) with localhost defaults. `dbname` overrides
    the database (used to connect to the maintenance 'postgres' db for CREATE DATABASE)."""
    url = os.environ.get("AUTH_DATABASE_URL")
    if url and dbname is None:
        return url
    host = os.environ.get("AUTH_PG_HOST") or os.environ.get("PGHOST") or "127.0.0.1"
    port = os.environ.get("AUTH_PG_PORT") or os.environ.get("PGPORT") or "5432"
    user = os.environ.get("AUTH_PG_USER") or os.environ.get("PGUSER") or "postgres"
    pw = os.environ.get("AUTH_PG_PASSWORD") or os.environ.get("PGPASSWORD") or ""
    db = dbname or os.environ.get("AUTH_PG_DATABASE") or os.environ.get("PGDATABASE") or "renewal_auth"
    # gssencmode=disable avoids the GSSAPI negotiation noise seen on macOS installs.
    return make_conninfo("", host=host, port=port, user=user, password=pw,
                         dbname=db, gssencmode="disable")


def auth_database() -> str:
    return os.environ.get("AUTH_PG_DATABASE") or os.environ.get("PGDATABASE") or "renewal_auth"


def raw_connect(dbname: str | None = None) -> psycopg.Connection:
    """One real connection (autocommit). Pass dbname='postgres' for the maintenance db."""
    return psycopg.connect(_conninfo(dbname), autocommit=True, row_factory=dict_row)


def _int_env(key: str, default: int) -> int:
    try:
        return int(os.environ.get(key) or default)
    except ValueError:
        return default


# Pooled, writable. autocommit=True: our statements are short & self-contained.
_pool = ConnectionPool(
    _conninfo(),
    min_size=1,
    max_size=_int_env("AUTH_DB_MAX_CONNS", 5),
    kwargs={"autocommit": True, "row_factory": dict_row},
    open=True,
)
atexit.register(_pool.close)
log.info(f"Auth DB pool initialized (db={auth_database()})", module="AuthDB", func="NewPool")


@contextmanager
def cursor():
    """Borrow a pooled connection and yield a dict cursor; returns it afterwards."""
    with _pool.connection() as conn:
        with conn.cursor() as cur:
            yield cur


def fetch_all(sql: str, params: list | tuple = ()) -> list[dict]:
    with cursor() as cur:
        cur.execute(sql, tuple(params))
        return cur.fetchall()


def fetch_one(sql: str, params: list | tuple = ()) -> dict | None:
    with cursor() as cur:
        cur.execute(sql, tuple(params))
        return cur.fetchone()


def execute(sql: str, params: list | tuple = ()) -> None:
    with cursor() as cur:
        cur.execute(sql, tuple(params))


def insert_returning_id(sql: str, params: list | tuple = ()) -> int:
    """Run an INSERT and return the new id via RETURNING. Pass an INSERT without
    a RETURNING clause — it is appended here."""
    with cursor() as cur:
        cur.execute(sql + " RETURNING id", tuple(params))
        row = cur.fetchone()
        return int(row["id"]) if row and row.get("id") is not None else 0
