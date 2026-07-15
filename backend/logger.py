"""File logger for the backend — mirrors the company-standard LogFiles layout:

    backend/LogFiles/Log/YYYYMMDD.log      <- system/technical (INFO/WARN/ERROR), one file per day
    backend/LogFiles/Error/YYYYMMDD.log    <- ERROR lines only (fast triage without the noise)
    backend/LogFiles/Activity/YYYYMMDD.log <- user activity trail ONLY: who viewed/filtered the
                                              policy list, downloaded CSVs, revealed mobile
                                              numbers, logged in/out. Kept separate so the
                                              "who did what" trail is never buried in
                                              request/system noise.

Line format:
    HH:MM:SS.mmm | LEVEL | Module >> function >> message

Module/function are auto-detected from the calling frame (auth_routes.login ->
"AuthRoutes >> login"), and can be overridden for infrastructure call sites
(e.g. module="Server", func="requestLogMiddleware").

Timestamps and file names use IST — same anchor as the rest of the app — so a
"day" in the logs matches the business day, not the server's UTC clock.
Files are opened in append mode per write: safe across uvicorn reloads/workers,
and day rollover needs no rotation logic.
"""
from __future__ import annotations

import sys
import threading
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path

IST = timezone(timedelta(hours=5, minutes=30))

_BASE = Path(__file__).resolve().parent / "LogFiles"
_LOG_DIR = _BASE / "Log"
_ERR_DIR = _BASE / "Error"
_ACT_DIR = _BASE / "Activity"
_lock = threading.Lock()


def _module_label(frame) -> str:
    """'auth_routes' -> 'AuthRoutes', 'main' -> 'Main'."""
    name = str(frame.f_globals.get("__name__", "?")).rsplit(".", 1)[-1]
    return "".join(part.capitalize() for part in name.split("_"))


def _write(level: str, msg: str, module: str | None, func: str | None,
           exc: BaseException | None = None) -> None:
    if module is None or func is None:
        caller = sys._getframe(2)  # 0=_write, 1=info/warn/error, 2=real caller
        module = module or _module_label(caller)
        func = func or caller.f_code.co_name
    now = datetime.now(IST)
    line = (f"{now:%H:%M:%S}.{now.microsecond // 1000:03d} | {level:<5} | "
            f"{module} >> {func} >> {msg}\n")
    if exc is not None:
        line += "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
        if not line.endswith("\n"):
            line += "\n"
    day = f"{now:%Y%m%d}.log"
    # User activity goes to its own trail, NOT the system log.
    dirs = [_ACT_DIR] if level == "AUDIT" else [_LOG_DIR] + ([_ERR_DIR] if level == "ERROR" else [])
    with _lock:
        try:
            for d in dirs:
                d.mkdir(parents=True, exist_ok=True)
                with open(d / day, "a", encoding="utf-8") as fh:
                    fh.write(line)
        except OSError:
            pass  # logging must never take the API down (disk full, perms, ...)


def info(msg: str, module: str | None = None, func: str | None = None) -> None:
    _write("INFO", msg, module, func)


def warn(msg: str, module: str | None = None, func: str | None = None) -> None:
    _write("WARN", msg, module, func)


def error(msg: str, module: str | None = None, func: str | None = None,
          exc: BaseException | None = None) -> None:
    _write("ERROR", msg, module, func, exc)


def activity(msg: str, module: str | None = None, func: str | None = None) -> None:
    """User activity trail (LogFiles/Activity): downloads, list/filter usage,
    mobile reveals, logins. Message should say WHO did WHAT (and with which filters)."""
    _write("AUDIT", msg, module, func)
