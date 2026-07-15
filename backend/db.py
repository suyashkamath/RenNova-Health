"""SQL Server connection POOL for the renewal dashboard.

Reads credentials from backend/.env (never hard-coded). The renewal data lives in
`saiba_renewal_transaction_data` inside `probus_autoboat_live`.

Why a pool: every request used to open a brand-new connection, and each open is a
full TCP + SQL Server login handshake — over the SSH tunnel that's hundreds of ms
BEFORE any row is read, paid again on every page and every filter change. The pool
keeps a small set of live connections and hands them out, so that cost is paid a
handful of times at most instead of per-request.

The public API is unchanged: callers still do
    conn = get_connection()
    try: ... conn.cursor(...) ...
    finally: conn.close()
Here `close()` returns the connection to the pool instead of really closing it.
Pool size is bounded by DB_MAX_CONNS (from .env).
"""
from __future__ import annotations

import atexit
import os
import queue
import threading
from pathlib import Path

import pymssql
from dotenv import load_dotenv

import logger as log

# load backend/.env regardless of the current working directory
load_dotenv(Path(__file__).resolve().parent / ".env")


def _server_and_port() -> tuple[str, int | None]:
    """MSSQL_SERVER may be 'host' or SQL Server's 'host,port' form."""
    raw = (os.environ.get("MSSQL_SERVER") or "127.0.0.1").strip()
    if "," in raw:
        host, port = raw.split(",", 1)
        return host.strip(), int(port.strip())
    return raw, None


def _int_env(key: str, default: int) -> int:
    try:
        return int(os.environ.get(key) or default)
    except ValueError:
        return default


def _raw_connect() -> pymssql.Connection:
    """One real connection to SQL Server."""
    host, port = _server_and_port()
    kwargs: dict = {
        "server": host,
        "user": os.environ.get("MSSQL_USER"),
        "password": os.environ.get("MSSQL_PASSWORD"),
        "database": os.environ.get("MSSQL_DATABASE"),
        # Autocommit so a pooled connection never carries an open transaction (and
        # its locks) into the next request that borrows it. All our queries are reads.
        "autocommit": True,
    }
    if port is not None:
        kwargs["port"] = port
    try:
        conn = pymssql.connect(**kwargs)
    except Exception as e:
        log.error(f"SQL Server connection failed: {e}", module="DB", func="NewPool", exc=e)
        raise
    log.info("SQL Server connection established", module="DB", func="NewPool")
    return conn


class _Pool:
    """Small thread-safe connection pool.

    FastAPI runs our sync endpoints in a threadpool, so acquire/release must be
    thread-safe. We lazily create connections up to `size`; once at the cap,
    acquire() blocks until another request returns one.
    """

    def __init__(self, size: int):
        self._size = max(1, size)
        self._free: queue.LifoQueue = queue.LifoQueue()  # LIFO: keep hot conns hot
        self._lock = threading.Lock()
        self._created = 0

    def acquire(self) -> pymssql.Connection:
        # Fast path: reuse an idle connection, validating it's still alive.
        while True:
            try:
                conn = self._free.get_nowait()
            except queue.Empty:
                break
            if self._alive(conn):
                return conn
            log.warn("Discarding dead pooled connection (tunnel dropped / server closed idle)",
                     module="DB", func="acquire")
            self._discard(conn)  # dead (tunnel dropped / server closed idle) -> drop

        # No idle connection: create one if we're under the cap...
        with self._lock:
            make = self._created < self._size
            if make:
                self._created += 1
        if make:
            try:
                return _raw_connect()
            except Exception:
                with self._lock:
                    self._created -= 1
                raise

        # ...otherwise wait for a busy connection to come back.
        conn = self._free.get()
        if self._alive(conn):
            return conn
        self._discard(conn)
        return self.acquire()

    def release(self, conn: pymssql.Connection) -> None:
        self._free.put(conn)

    def _alive(self, conn: pymssql.Connection) -> bool:
        try:
            cur = conn.cursor()
            cur.execute("SELECT 1")
            cur.fetchall()
            return True
        except Exception:
            return False

    def _discard(self, conn: pymssql.Connection) -> None:
        try:
            conn.close()
        except Exception:
            pass
        with self._lock:
            self._created -= 1

    def close_all(self) -> None:
        while True:
            try:
                conn = self._free.get_nowait()
            except queue.Empty:
                return
            try:
                conn.close()
            except Exception:
                pass


_pool = _Pool(_int_env("DB_MAX_CONNS", 15))
atexit.register(_pool.close_all)
log.info(f"Database pool initialized (max={_int_env('DB_MAX_CONNS', 15)} connections)",
         module="DB", func="NewPool")


class _PooledConnection:
    """Thin proxy so callers keep using `conn.cursor(...)` / `conn.close()`.

    close() hands the underlying connection back to the pool instead of tearing it
    down. If work on the connection raised, it's returned as broken so the pool
    can replace it rather than reuse a possibly-wedged session.
    """

    __slots__ = ("_raw", "_pool", "_closed")

    def __init__(self, raw: pymssql.Connection, pool: _Pool):
        self._raw = raw
        self._pool = pool
        self._closed = False

    def cursor(self, *args, **kwargs):
        return self._raw.cursor(*args, **kwargs)

    def __getattr__(self, name):
        # Delegate anything else (commit, rollback, etc.) to the real connection.
        return getattr(self._raw, name)

    def close(self) -> None:
        # Return to the pool without a round-trip here. If the connection went bad
        # (e.g. a query errored mid-flight), the next acquire()'s liveness check
        # catches it and discards it — so we validate once, on the way out, not twice.
        if self._closed:
            return
        self._closed = True
        self._pool.release(self._raw)


def get_connection() -> _PooledConnection:
    """Borrow a connection from the pool. Call .close() to return it."""
    return _PooledConnection(_pool.acquire(), _pool)
