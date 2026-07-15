"""Renewal Dashboard API (FastAPI).

All aggregation runs in SQL Server (COUNT/SUM/GROUP BY) — the backend holds no
rows in memory, so it scales to lakhs. JSON is camelCase to keep the existing
Angular frontend working unchanged.
"""
from __future__ import annotations

import csv
import io
import os
import time
from datetime import date, datetime, timedelta, timezone

# The business runs in India — anchor "today" to IST (+05:30), NOT the server's
# local/UTC clock, so the calendar & KPIs don't shift for 5.5h after IST midnight
# when deployed on a UTC server.
IST = timezone(timedelta(hours=5, minutes=30))


def ist_today() -> date:
    return datetime.now(IST).date()

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

import logger as log
import queries as q
import rbac
import security
from adapter import TABLE
from auth_routes import router as auth_router
from db import get_connection
from management import router as management_router

# Fail closed: refuse to boot without a strong JWT secret (no forgeable fallback).
security.assert_secret_present()
log.info("Environment variables loaded from .env", module="Config", func="loadDotEnv")
log.info("Configuration loaded", module="Main", func="main")

app = FastAPI(title="Renewal Dashboard API")


@app.on_event("startup")
def _log_startup():
    log.info("Starting HTTP server", module="Main", func="serverRoutine")


@app.middleware("http")
async def request_log_middleware(request: Request, call_next):
    """One line per request: METHOD /path -> status (ms). 4xx/5xx go to the Error
    folder too; unhandled exceptions are logged with a full traceback."""
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception as e:
        ms = int((time.perf_counter() - start) * 1000)
        log.error(f"{request.method} {request.url.path} -> 500 ({ms}ms) | unhandled: {e}",
                  module="Server", func="requestLogMiddleware", exc=e)
        raise
    ms = int((time.perf_counter() - start) * 1000)
    line = f"{request.method} {request.url.path} -> {response.status_code} ({ms}ms)"
    if response.status_code >= 400:
        log.error(line, module="Server", func="requestLogMiddleware")
    else:
        log.info(line, module="Server", func="requestLogMiddleware")
    return response

# Lock CORS to the real frontend origin(s). Wildcard '*' is only used if explicitly
# configured (dev). Set AUTH_CORS_ORIGINS as a comma-separated list in .env.
_origins = [o.strip() for o in (os.environ.get("AUTH_CORS_ORIGINS") or "http://localhost:4200").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

log.info(f"CORS locked to origins: {', '.join(_origins)}", module="Main", func="main")

app.include_router(auth_router)
app.include_router(management_router)
log.info("Auth & management routers mounted", module="Main", func="main")

_FILTER_KEYS = (
    "from", "to", "company", "rm", "posp", "platform", "product", "subProduct",
    "region", "branch", "vertical", "channel", "isRenewed", "hasPaymentLink",
    "noticeAvailable", "search", "searchField",
)


def read_filters(request: Request) -> dict:
    qp = request.query_params
    return {k: qp[k] for k in _FILTER_KEYS if qp.get(k)}


def public_filters(f: dict) -> dict:
    """Filters as sent by the client, for audit `details` — drops the injected
    server-side `_scope` (internal) and empty values."""
    return {k: v for k, v in f.items() if k != "_scope" and v}


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def filters_label(f: dict) -> str:
    """Human-readable filter summary for the Activity trail."""
    pub = public_filters(f)
    return ", ".join(f"{k}={v}" for k, v in pub.items()) or "none"


def get_today(request: Request) -> str:
    """?today= override (useful for testing), validated — garbage falls back to today
    instead of 500ing deeper in the code."""
    t = request.query_params.get("today")
    if t:
        try:
            return date.fromisoformat(t).isoformat()
        except ValueError:
            pass
    return ist_today().isoformat()


def int_qp(request: Request, key: str, default: int) -> int:
    """Int query param; malformed values fall back to the default instead of 500."""
    try:
        return int(request.query_params.get(key) or default)
    except ValueError:
        return default


@app.get("/api/health")
def health():
    conn = get_connection()
    try:
        cur = conn.cursor(as_dict=True)
        frm, to = q.monthly_window()
        cur.execute(
            f"SELECT COUNT(*) c FROM {TABLE} WITH (NOLOCK) WHERE policy_exp_date BETWEEN %s AND %s",
            [frm, to],
        )
        count = cur.fetchone()["c"]
        log.info(f"Health check OK — window {frm}..{to}, {count} policies")
        return {"ok": True, "table": TABLE, "window": [frm, to], "windowCount": count}
    finally:
        conn.close()


@app.get("/api/filters")
def filters(request: Request, user: dict = Depends(rbac.current_user)):
    # Dependent (faceted) dropdowns: each list respects the OTHER active filters, so
    # picking Product = Health shrinks RM/POSP/Company/… to only Health's values. Each
    # dropdown excludes its OWN filter so the current selection stays switchable.
    base = rbac.apply_scope(q.default_window(read_filters(request)), user)
    conn = get_connection()
    try:
        cur = conn.cursor(as_dict=True)

        def wx(*exclude):
            return q.build_where({k: v for k, v in base.items() if k not in exclude})

        w_company, p_company = wx("company")
        w_rm, p_rm = wx("rm")
        w_posp, p_posp = wx("posp")
        w_platform, p_platform = wx("platform")
        w_vertical, p_vertical = wx("vertical")
        w_product, p_product = wx("product", "subProduct")  # keep products fully switchable
        w_sub, p_sub = wx("subProduct")                     # sub-products cascade from product
        log.info(f"Filter facets computed for user '{user['username']}'")
        return {
            "companies": q.distinct_expr(cur, "company_name", w_company, p_company),
            # RM = am_id <> 0 only (am_id = 0 is customer-direct; its rm_name is junk
            # like region codes 'GJ'/'RJ2', not real RMs). POSP is a separate field.
            "rms": q.distinct_expr(cur, "rm_name", w_rm, p_rm, extra="am_id <> 0"),
            "posps": q.distinct_expr(cur, "pos_name", w_posp, p_posp, limit=20000),
            "platforms": q.distinct_expr(cur, q.PLATFORM, w_platform, p_platform),
            "products": q.distinct_products(cur, w_product, p_product),
            "subProducts": q.distinct_subproducts(cur, w_sub, p_sub),
            "regions": q.distinct_master(cur, "RegionName"),
            "branches": q.distinct_branches(cur),
            "verticals": q.distinct_expr(cur, q.VERTICAL, w_vertical, p_vertical),
            "expDateMin": base["from"],
            "expDateMax": base["to"],
        }
    finally:
        conn.close()


@app.get("/api/dashboard")
def dashboard(request: Request, user: dict = Depends(rbac.require_view("DASHBOARD"))):
    f = rbac.apply_scope(q.default_window(read_filters(request)), user)
    today = get_today(request)
    preset = request.query_params.get("preset") or ""
    # When a preset is active, derive BOTH the current and previous windows from the
    # fiscal-period engine so the "vs last period" comparison can never drift out of
    # alignment (the current window comes from the preset, not from a stale from/to).
    # 'custom' returns the picked range as its current window unchanged.
    prev = None
    pw = q.period_window(preset, date.fromisoformat(today), f.get("from"), f.get("to"))
    if pw:
        cf, ct, pf, pt, _ = pw
        f["from"], f["to"] = cf, ct
        prev = {**f, "from": pf, "to": pt}
    else:
        prev = q.prev_period(f)
    where, p = q.build_where(f)
    conn = get_connection()
    try:
        cur = conn.cursor(as_dict=True)
        # Scan the big table ONCE into a temp table, then aggregate from it (fast).
        src = q.materialize_window(cur, where, p)
        # "vs last period" deltas on the KPI cards -> one extra bounded aggregate.
        kpis_prev = None
        if prev:
            wp, pp = q.build_where(prev)
            kpis_prev = q.kpis(cur, wp, pp)
        # NOTE: the trend is NOT here — it's standalone (GET /api/trend, 12-month
        # lookback), so the dashboard skips that whole aggregation.
        log.info(f"Dashboard aggregated for {f['from']}..{f['to']} "
                 f"(preset={preset or 'none'}) by '{user['username']}'")
        return {
            "today": today,
            "kpis": q.kpis(cur, "", [], src=src),
            "kpisPrev": kpis_prev,
            "platformSplit": q.split_platform(cur, "", [], src=src),
            "channelSplit": q.split_channel(cur, "", [], src=src),
            "segmentSplit": q.split_segment(cur, "", [], src=src),
            "companyRanking": q.rank(cur, "", [], "company_name", src=src),
            "rmRanking": q.rank(cur, "", [], "rm_name", src=src),
            "pospRanking": q.rank(cur, "", [], "pos_name", src=src),
            "regionRanking": q.rank_master(cur, "RegionName", src=src),
            "branchRanking": q.rank_master(cur, "BranchName", src=src),
        }
    finally:
        conn.close()


@app.get("/api/trend")
def trend(request: Request, user: dict = Depends(rbac.require_view("DASHBOARD"))):
    # Period-aware trend: plot ONE continuous window spanning the previous comparable
    # period + the current period, so the chart shows "last period | this period" with
    # a divider at curFrom (drawn client-side). Bucket (day/month) is derived from the
    # preset; ?trendBy= can still override it. Falls back to the trailing 12-month
    # lookback when no preset is sent.
    f = rbac.apply_scope(read_filters(request), user)
    today = get_today(request)
    preset = request.query_params.get("preset") or ""
    pw = q.period_window(preset, date.fromisoformat(today), f.get("from"), f.get("to"))
    if pw:
        cur_from, cur_to, prev_from, _prev_to, bucket = pw
        win_from, win_to = prev_from, cur_to
    else:
        win_from, win_to = q.trend_window(date.fromisoformat(today))
        cur_from, bucket = win_from, "month"
    override = request.query_params.get("trendBy")
    by = override if override in ("day", "month") else bucket
    f = {**f, "from": win_from, "to": win_to}
    where, p = q.build_where(f)
    conn = get_connection()
    try:
        cur = conn.cursor(as_dict=True)
        log.info(f"Trend computed {win_from}..{win_to} by {by} for '{user['username']}'")
        return {"from": win_from, "to": win_to, "curFrom": cur_from, "bucket": by,
                "trend": q.trend(cur, where, p, by)}
    finally:
        conn.close()


@app.get("/api/calendar")
def calendar(request: Request, user: dict = Depends(rbac.require_view("DASHBOARD"))):
    f = rbac.apply_scope(read_filters(request), user)
    today = get_today(request)
    month = request.query_params.get("month") or today[:7]
    # Validate ?month=yyyy-mm — malformed input falls back to the current month.
    try:
        y, m = (int(x) for x in month.split("-"))
        assert 1 <= m <= 12
        month = f"{y:04d}-{m:02d}"
    except (ValueError, AssertionError):
        month = today[:7]
    where, p = q.build_where(f, include_dates=False)  # calendar shows the whole month
    conn = get_connection()
    try:
        cur = conn.cursor(as_dict=True)
        log.info(f"Calendar computed for {month} for '{user['username']}'")
        return {"month": month, "today": today, "days": q.calendar_days(cur, where, p, month)}
    finally:
        conn.close()


@app.get("/api/policies")
def policies(request: Request, user: dict = Depends(rbac.require_view("POLICIES"))):
    f = rbac.apply_scope(q.default_window(read_filters(request)), user)
    qp = request.query_params
    page = max(1, int_qp(request, "page", 1))
    page_size = min(500, max(1, int_qp(request, "pageSize", 50)))
    sort_by = qp.get("sortBy") or "policyExpDate"
    desc = qp.get("sortDir") == "desc"
    where, p = q.build_where(f)
    conn = get_connection()
    try:
        cur = conn.cursor(as_dict=True)
        rows, total = q.policies(cur, where, p, page, page_size, sort_by, desc)
    finally:
        conn.close()
    # Audit trail: who opened the policy list, with which filters, when, from where.
    rbac.audit(user["id"], "POLICY_LIST_VIEW", "policy_list", None,
               {"page": page, "pageSize": page_size, "total": total,
                "filters": public_filters(f)}, client_ip(request))
    log.activity(f"'{user['username']}' viewed policy list page {page} "
                 f"({len(rows)}/{total} rows) | filters: {filters_label(f)}")
    return {"total": total, "page": page, "pageSize": page_size, "rows": rows}


@app.get("/api/policies/{policy_id}/mobile")
def reveal_mobile(policy_id: str, request: Request, user: dict = Depends(rbac.require_view("POLICIES"))):
    """Reveal ONE customer's full mobile number — the list & CSV only ever carry the
    masked value. Scope-enforced (a scoped user can't reveal rows outside their book)
    and audit-logged per reveal."""
    f = rbac.apply_scope({}, user)
    where, p = q.build_where(f, include_dates=False)
    w = q._and(where, "id = %s")
    conn = get_connection()
    try:
        cur = conn.cursor(as_dict=True)
        cur.execute(f"SELECT TOP 1 cust_mobile FROM {TABLE} WITH (NOLOCK){w}", p + [policy_id])
        row = cur.fetchone()
    finally:
        conn.close()
    if not row:
        log.warn(f"Mobile reveal denied — policy {policy_id} not found/out of scope "
                 f"for '{user['username']}'")
        raise HTTPException(404, "Policy not found")
    rbac.audit(user["id"], "MOBILE_REVEAL", "policy", None, {"policyId": policy_id},
               client_ip(request))
    log.activity(f"'{user['username']}' revealed mobile number for policy {policy_id}")
    return {"mobile": str(row["cust_mobile"] or "").strip() or None}


# Columns exported to CSV (camelCase keys on the normalized record).
_EXPORT_COLS = [
    "policyNo", "insuredName", "custMobile", "vehicleRegiNo", "make", "companyName",
    "policyType", "segment", "regionName", "branchName", "policyExpDate",
    "rmName", "rmEmail", "rmMobile", "posName", "posEmail", "posMobile",
    "platform", "channel", "netPremium", "grossPremium", "paymentLink", "noticeUrl",
    "noticeAvailable", "isRenewed",
]


@app.get("/api/policies/export")
def export(request: Request, user: dict = Depends(rbac.require_view("POLICIES", "can_export"))):
    """Stream the FULL filtered set as CSV, fetched page-by-page so neither the
    backend nor the browser ever holds everything at once."""
    f = rbac.apply_scope(q.default_window(read_filters(request)), user)
    qp = request.query_params
    sort_by = qp.get("sortBy") or "policyExpDate"
    desc = qp.get("sortDir") == "desc"
    where, p = q.build_where(f)

    def rows_csv():
        conn = get_connection()
        try:
            cur = conn.cursor(as_dict=True)
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow(_EXPORT_COLS)
            yield buf.getvalue()
            page, size = 1, 1000
            while True:
                # policy_rows (no COUNT) — counting every page would rescan the
                # whole filtered set once per 1000 rows on a big export.
                rows = q.policy_rows(cur, where, p, page, size, sort_by, desc)
                if not rows:
                    break
                buf = io.StringIO()
                w = csv.writer(buf)
                for r in rows:
                    w.writerow([r.get(c) for c in _EXPORT_COLS])
                yield buf.getvalue()
                if len(rows) < size:
                    break
                page += 1
        finally:
            conn.close()

    fname = f"Renewal_Policies_{ist_today().isoformat()}.csv"
    # Audit trail: who downloaded which cut of the book (filters pin down the cut).
    rbac.audit(user["id"], "EXPORT_CSV", "policy_list", None,
               {"file": fname, "filters": public_filters(f)}, client_ip(request))
    log.activity(f"'{user['username']}' downloaded CSV export '{fname}' "
                 f"| filters: {filters_label(f)}")
    return StreamingResponse(
        rows_csv(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
