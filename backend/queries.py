"""SQL-side aggregation. The database does every COUNT / SUM / GROUP BY, so the
backend never holds the table in memory — it scales to lakhs of rows.

Every builder returns parameterized SQL using pymssql's %s placeholders; the
params are passed positionally in the order the %s appear in the final SQL text.
"""
from __future__ import annotations

from datetime import date, timedelta

from adapter import (COLUMNS, HEALTH_SUB_PRODUCT_MAP, PRODUCT_MAP, TABLE,
                     record_from_row, sub_product_name)

# Reusable boolean expressions (must match the normalization in adapter.record_from_row).
# NULLIF(...'') so empty/whitespace values (not just NULL) also fall back to
# 'UNKNOWN' — otherwise a blank platform ('') shows up as an empty-label split row.
PLATFORM = "UPPER(ISNULL(NULLIF(LTRIM(RTRIM(platform)), ''), 'UNKNOWN'))"
VERTICAL = "UPPER(ISNULL(NULLIF(LTRIM(RTRIM(vertical_name)), ''), 'UNKNOWN'))"
POLICY_TYPE = "UPPER(ISNULL(NULLIF(LTRIM(RTRIM(policy_type)), ''), 'UNKNOWN'))"
PAYLINK = "(payment_link IS NOT NULL AND LTRIM(RTRIM(payment_link)) <> '')"
# CAST control_no to varchar so this works whether the column is numeric or text
# (a bare `control_no <> 0` would throw a conversion error on non-numeric strings).
# Empty/'0' both mean "no control number" — matches adapter.record_from_row.
NOTICE = ("(pdf_trn_id > 0 AND control_no IS NOT NULL "
          "AND LTRIM(RTRIM(CAST(control_no AS varchar(64)))) NOT IN ('', '0'))")
RENEWED_1 = "SUM(CASE WHEN is_renewed = 1 THEN 1 ELSE 0 END)"

# Master-user view (other DB, same server): user_id (POSP) -> region/branch.
MASTER = "probus_web_live.dbo.vw_master_user"

# Whitelist for ORDER BY on the detail list (ORDER BY can't be parameterized).
SORT_COLS = {
    "policyExpDate": "policy_exp_date", "policyNo": "policy_no",
    "companyName": "company_name", "insuredName": "insured_name",
    "rmName": "rm_name", "posName": "pos_name", "netPremium": "net_premium",
    "grossPremium": "gross_premium", "isRenewed": "is_renewed",
    "vehicleRegiNo": "vehicle_regi_no",
    "segment": "sub_product_id",  # segment = sub-product name; id order groups them
}

def _i(v) -> int:
    """decimal / None -> int rupees."""
    return int(round(float(v))) if v is not None else 0


def _from(src: str) -> str:
    """NOLOCK only on the real base table; temp tables don't need the hint."""
    return f"{TABLE} WITH (NOLOCK)" if src == TABLE else src


# Columns the dashboard aggregations need — pulled once into a temp table so the
# big base table is scanned ONCE per request instead of once per aggregation.
_MAT_COLS = ("is_renewed, gross_premium, net_premium, policy_exp_date, company_name, "
             "rm_name, pos_name, platform, am_id, sub_product_id, payment_link, "
             "control_no, pdf_trn_id, user_id")


def materialize_window(cur, where, p, tmp="#w") -> str:
    """Copy the filtered window into a session temp table; return its name.

    Connections are pooled and reused, so a session-scoped temp table from a
    previous request can still exist — drop it first to keep this idempotent
    (otherwise SELECT ... INTO would fail with "object already exists").
    """
    cur.execute(f"IF OBJECT_ID('tempdb..{tmp}') IS NOT NULL DROP TABLE {tmp}")
    cur.execute(f"SELECT {_MAT_COLS} INTO {tmp} FROM {TABLE} WITH (NOLOCK){where}", p)
    return tmp


def _and(where: str, extra: str) -> str:
    return f"{where} AND {extra}" if where else f" WHERE {extra}"


# ---------- fiscal-period engine (financial year = April .. March) ----------

def _month_end(y: int, m: int) -> date:
    """Last calendar day of month m in year y."""
    ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
    return date(ny, nm, 1) - timedelta(days=1)


def _shift_month(y: int, m: int, n: int) -> tuple[int, int]:
    """(year, month) shifted by n months (n may be negative)."""
    idx = (y * 12 + (m - 1)) + n
    return idx // 12, idx % 12 + 1


def fiscal_year_start(d: date) -> date:
    """1 April of the financial year containing d (FY runs April..March).
    e.g. any date Apr 2026..Mar 2027 -> 1 April 2026."""
    return date(d.year if d.month >= 4 else d.year - 1, 4, 1)


def period_window(preset: str, today: date | None = None,
                  frm: str | None = None, to: str | None = None):
    """The core period engine. For a given preset it returns
        (cur_from, cur_to, prev_from, prev_to, bucket)
    as ISO strings + a 'day'/'month' bucket for the trend chart. Financial year =
    April..March. The 'previous' window is period-ALIGNED (previous calendar month /
    fiscal quarter / fiscal year / calendar-block week), except 'custom' which mirrors
    the selected span immediately before it. Returns None if custom dates are bad.

    Anchored to today = 9 Jul 2026 as a worked example:
      weekly    -> 08-14 Jul  vs 01-07 Jul                (calendar blocks 1-7/8-14/15-21/22-end)
      monthly   -> 01-31 Jul  vs 01-30 Jun                (clean calendar months)
      prevMonth -> 01-30 Jun  vs 01-31 May                (last month's book)
      nextMonth -> 01-31 Aug  vs 01-31 Jul                (upcoming renewal book)
      quarterly -> Jul-Sep    vs Apr-Jun                  (fiscal Q2 vs Q1)
      yearly    -> Apr26-Mar27 vs Apr25-Mar26             (FY26 vs FY25)
      custom    -> [from..to] vs equal span just before it
    """
    d = today or date.today()

    def R(cf: date, ct: date, pf: date, pt: date, bucket: str):
        return (cf.isoformat(), ct.isoformat(), pf.isoformat(), pt.isoformat(), bucket)

    if preset == "yesterday":
        y = d - timedelta(days=1)
        pp = y - timedelta(days=1)
        return R(y, y, pp, pp, "day")

    if preset == "weekly":
        # Calendar blocks within the month: [1-7], [8-14], [15-21], [22-end].
        starts = [1, 8, 15, 22]
        bs = max(s for s in starts if s <= d.day)
        cur_from = date(d.year, d.month, bs)
        cur_to = _month_end(d.year, d.month) if bs == 22 else date(d.year, d.month, bs + 6)
        if bs == 1:  # previous block is the last block (22-end) of the previous month
            py, pm = _shift_month(d.year, d.month, -1)
            prev_from, prev_to = date(py, pm, 22), _month_end(py, pm)
        else:
            pbs = starts[starts.index(bs) - 1]
            prev_from, prev_to = date(d.year, d.month, pbs), date(d.year, d.month, bs - 1)
        return R(cur_from, cur_to, prev_from, prev_to, "day")

    if preset == "monthly":
        cur_from, cur_to = date(d.year, d.month, 1), _month_end(d.year, d.month)
        py, pm = _shift_month(d.year, d.month, -1)
        return R(cur_from, cur_to, date(py, pm, 1), _month_end(py, pm), "day")

    if preset == "prevMonth":
        # Previous calendar month; compares to the month before THAT (period-aligned).
        py, pm = _shift_month(d.year, d.month, -1)
        ppy, ppm = _shift_month(d.year, d.month, -2)
        return R(date(py, pm, 1), _month_end(py, pm),
                 date(ppy, ppm, 1), _month_end(ppy, ppm), "day")

    if preset == "nextMonth":
        # Next calendar month (the upcoming renewal book); compares to the current month.
        ny, nm = _shift_month(d.year, d.month, 1)
        return R(date(ny, nm, 1), _month_end(ny, nm),
                 date(d.year, d.month, 1), _month_end(d.year, d.month), "day")

    if preset == "quarterly":
        # Fiscal quarters: Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar.
        fy = fiscal_year_start(d)
        mi = (d.year - fy.year) * 12 + (d.month - fy.month)   # months since 1 April (0..11)
        qsy, qsm = _shift_month(fy.year, fy.month, (mi // 3) * 3)   # quarter start
        cey, cem = _shift_month(qsy, qsm, 2)
        psy, psm = _shift_month(qsy, qsm, -3)                       # previous quarter start
        pey, pem = _shift_month(psy, psm, 2)
        return R(date(qsy, qsm, 1), _month_end(cey, cem),
                 date(psy, psm, 1), _month_end(pey, pem), "month")

    if preset == "yearly":
        fy = fiscal_year_start(d)
        return R(fy, _month_end(fy.year + 1, 3),
                 date(fy.year - 1, 4, 1), _month_end(fy.year, 3), "month")

    # custom: mirror the selected span onto the equal window immediately before it.
    try:
        d0, d1 = date.fromisoformat(str(frm)), date.fromisoformat(str(to))
    except (ValueError, TypeError):
        return None
    if d1 < d0:
        return None
    span = (d1 - d0).days + 1
    bucket = "day" if span <= 92 else "month"    # ~a quarter of daily points stays readable
    return R(d0, d1, d0 - timedelta(days=span), d0 - timedelta(days=1), bucket)


def monthly_window(today: date | None = None) -> tuple[str, str]:
    """Default scan window = the current CALENDAR month [1st .. last day].
    Computed from the current month, so it auto-advances on the 1st — no scheduler.
    e.g. any day in July -> 1 July .. 31 July. (Financial year = April..March; the
    fiscal quarter/year presets live in period_window.)"""
    d = today or date.today()
    return date(d.year, d.month, 1).isoformat(), _month_end(d.year, d.month).isoformat()


def trend_window(today: date | None = None) -> tuple[str, str]:
    """Trailing 12-month lookback for the STANDALONE renewal trend: the 1st of the
    month 11 months back .. the last day of the current month (12 monthly buckets).
    Independent of the dashboard's date filter — the trend always shows a full year
    of context (1 year back from the current month), like the calendar is standalone."""
    d = today or date.today()
    cur_first = date(d.year, d.month, 1)                 # 1st of the current month M
    y, m = cur_first.year, cur_first.month - 11          # 11 months back -> 12 months inclusive
    while m <= 0:
        m += 12
        y -= 1
    frm = date(y, m, 1)
    ny, nm = (cur_first.year + 1, 1) if cur_first.month == 12 else (cur_first.year, cur_first.month + 1)
    to = date(ny, nm, 1) - timedelta(days=1)             # last day of the current month
    return frm.isoformat(), to.isoformat()


def default_window(f: dict) -> dict:
    """Bound the scan by the current monthly renewal window so we never table-scan
    the full lakhs of rows. Any explicit from/to from the UI overrides it."""
    f = dict(f)
    frm, to = monthly_window()
    if not f.get("from"):
        f["from"] = frm
    if not f.get("to"):
        f["to"] = to
    return f


def prev_period(f: dict) -> dict | None:
    """Legacy fallback (no preset): same filters shifted to the equal-length window
    immediately BEFORE [from, to] — powers the 'vs last period' badges. Preset-aware
    callers use period_window directly for a period-ALIGNED previous window.
    e.g. 1 Jul..31 Jul -> 1 Jun..30 Jun. None if dates are missing/bad."""
    frm, to = f.get("from"), f.get("to")
    if not frm or not to:
        return None
    try:
        d0, d1 = date.fromisoformat(str(frm)), date.fromisoformat(str(to))
    except ValueError:
        return None
    if d1 < d0:
        return None
    span = (d1 - d0).days + 1
    g = dict(f)
    g["from"] = (d0 - timedelta(days=span)).isoformat()
    g["to"] = (d0 - timedelta(days=1)).isoformat()
    return g


def _int_or(v):
    s = str(v).strip()
    return int(s) if s.lstrip("-").isdigit() else s


def _ph(vals) -> str:
    """Comma-separated %s placeholders for an IN-list of len(vals)."""
    return ", ".join(["%s"] * len(vals))


def build_where(f: dict, include_dates: bool = True):
    """Translate the dashboard filters into a parameterized WHERE clause.
    Product/sub-product are dropdown-driven (empty = All, no filter)."""
    cl: list[str] = []
    p: list = []
    if f.get("product"):
        cl.append("product_id = %s"); p.append(_int_or(f["product"]))
    if f.get("subProduct"):
        cl.append("sub_product_id = %s"); p.append(_int_or(f["subProduct"]))
    if include_dates:
        if f.get("from"):
            cl.append("policy_exp_date >= %s"); p.append(f["from"])
        if f.get("to"):
            cl.append("policy_exp_date <= %s"); p.append(f["to"])
    if f.get("company"):
        cl.append("company_name = %s"); p.append(f["company"])
    if f.get("rm"):
        cl.append("rm_name = %s"); p.append(f["rm"])
    if f.get("posp"):
        cl.append("pos_name = %s"); p.append(f["posp"])
    if f.get("region"):
        cl.append(f"user_id IN (SELECT UserId FROM {MASTER} WHERE RegionName = %s)")
        p.append(f["region"])
    if f.get("branch"):
        cl.append(f"user_id IN (SELECT UserId FROM {MASTER} WHERE BranchName = %s)")
        p.append(f["branch"])
    # RBAC row-level scope (server-injected, NEVER from the client). A scoped user
    # sees only rows matching ANY of their region/branch/AM scopes. Present-but-empty
    # means "scoped user with no grants" -> sees nothing (fail-closed).
    scope = f.get("_scope")
    if scope is not None:
        regions = scope.get("regions") or []
        branches = scope.get("branches") or []
        ams = [a for a in (scope.get("ams") or []) if a is not None]
        ors: list[str] = []
        mu: list[str] = []
        if regions:
            mu.append(f"RegionName IN ({_ph(regions)})"); p.extend(regions)
        if branches:
            mu.append(f"BranchName IN ({_ph(branches)})"); p.extend(branches)
        if mu:
            ors.append(f"user_id IN (SELECT UserId FROM {MASTER} WHERE {' OR '.join(mu)})")
        if ams:
            ors.append(f"am_id IN ({_ph(ams)})"); p.extend(ams)
        cl.append("(" + " OR ".join(ors) + ")" if ors else "1 = 0")
    if f.get("platform"):
        cl.append(f"{PLATFORM} = %s"); p.append(f["platform"].upper())
    if f.get("vertical"):
        cl.append(f"{VERTICAL} = %s"); p.append(f["vertical"].upper())
    if f.get("policyType"):
        cl.append(f"{POLICY_TYPE} = %s"); p.append(f["policyType"].upper())
    if f.get("channel") == "RM":
        cl.append("(am_id IS NOT NULL AND am_id <> 0)")
    if f.get("channel") == "CUSTOMER":
        cl.append("(am_id IS NULL OR am_id = 0)")
    if f.get("isRenewed") == "1":
        cl.append("is_renewed = 1")
    if f.get("isRenewed") == "0":
        cl.append("is_renewed = 0")
    if f.get("hasPaymentLink") == "1":
        cl.append(PAYLINK)
    if f.get("hasPaymentLink") == "0":
        cl.append(f"NOT {PAYLINK}")
    if f.get("noticeAvailable") == "1":
        cl.append(NOTICE)
    if f.get("noticeAvailable") == "0":
        cl.append(f"NOT {NOTICE}")
    if f.get("search"):
        like = f"%{f['search']}%"
        # searchField narrows the match to one column; blank/"all" keeps the
        # original 4-column blanket search.
        col = {
            "policyNo": "policy_no",
            "name": "insured_name",
            "vehicle": "vehicle_regi_no",
            "mobile": "cust_mobile",
        }.get(f.get("searchField") or "")
        if col:
            cl.append(f"{col} LIKE %s")
            p.append(like)
        else:
            cl.append("(policy_no LIKE %s OR insured_name LIKE %s OR vehicle_regi_no LIKE %s OR company_name LIKE %s)")
            p += [like, like, like, like]
    where = (" WHERE " + " AND ".join(cl)) if cl else ""
    return where, p


# ---------- aggregations ----------

def kpis(cur, where, p, src=TABLE) -> dict:
    cur.execute(f"""
      SELECT
        COUNT(*) due,
        {RENEWED_1} renewed,
        SUM(gross_premium) exp_g, SUM(net_premium) exp_n,
        SUM(CASE WHEN is_renewed = 1 THEN gross_premium ELSE 0 END) col_g,
        SUM(CASE WHEN is_renewed = 1 THEN net_premium ELSE 0 END) col_n,
        SUM(CASE WHEN {PAYLINK} THEN 1 ELSE 0 END) paylink,
        SUM(CASE WHEN {NOTICE} THEN 1 ELSE 0 END) notice,
        SUM(CASE WHEN {PLATFORM} = 'ONLINE' THEN 1 ELSE 0 END) online,
        SUM(CASE WHEN {PLATFORM} = 'OFFLINE' THEN 1 ELSE 0 END) offline,
        SUM(CASE WHEN am_id IS NOT NULL AND am_id <> 0 THEN 1 ELSE 0 END) rm_ch,
        SUM(CASE WHEN am_id IS NULL OR am_id = 0 THEN 1 ELSE 0 END) cust_ch
      FROM {_from(src)}{where}""", p)
    r = cur.fetchone()
    due = r["due"] or 0
    renewed = r["renewed"] or 0
    eg = _i(r["exp_g"])
    return {
        "due": due, "renewed": renewed, "pending": due - renewed,
        "renewalPct": round(renewed / due * 100, 1) if due else 0.0,
        "expectedPremiumGross": eg, "expectedPremiumNet": _i(r["exp_n"]),
        "collectedPremiumGross": _i(r["col_g"]), "collectedPremiumNet": _i(r["col_n"]),
        "paymentLinkAvailable": r["paylink"] or 0, "noticeAvailable": r["notice"] or 0,
        "onlineCount": r["online"] or 0, "offlineCount": r["offline"] or 0,
        "rmChannelCount": r["rm_ch"] or 0, "customerChannelCount": r["cust_ch"] or 0,
        "avgGrossPremium": round(eg / due) if due else 0,
    }


def rank(cur, where, p, col, top=50, src=TABLE) -> list[dict]:
    cur.execute(f"""
      SELECT TOP {int(top)} {col} label, COUNT(*) due, {RENEWED_1} renewed,
        SUM(gross_premium) exp_g,
        SUM(CASE WHEN is_renewed = 1 THEN gross_premium ELSE 0 END) col_g
      FROM {_from(src)}{_and(where, f"{col} IS NOT NULL")}
      GROUP BY {col} ORDER BY COUNT(*) DESC""", p)
    out = []
    for r in cur.fetchall():
        due = r["due"] or 0
        rn = r["renewed"] or 0
        out.append({
            "label": str(r["label"]), "due": due, "renewed": rn, "pending": due - rn,
            "renewalPct": round(rn / due * 100, 1) if due else 0.0,
            "expectedPremiumGross": _i(r["exp_g"]), "collectedPremiumGross": _i(r["col_g"]),
        })
    return out


def rank_master(cur, attr, src="#w", top=50) -> list[dict]:
    """Rank by a master-user attribute (RegionName / BranchName) — joins the working
    set to vw_master_user on user_id (POSP)."""
    cur.execute(f"""
      SELECT TOP {int(top)} mu.{attr} label, COUNT(*) due,
        SUM(CASE WHEN w.is_renewed = 1 THEN 1 ELSE 0 END) renewed,
        SUM(w.gross_premium) exp_g,
        SUM(CASE WHEN w.is_renewed = 1 THEN w.gross_premium ELSE 0 END) col_g
      FROM {_from(src)} w
      JOIN {MASTER} mu ON mu.UserId = w.user_id
      WHERE mu.{attr} IS NOT NULL AND mu.{attr} <> ''
      GROUP BY mu.{attr} ORDER BY COUNT(*) DESC""")
    out = []
    for r in cur.fetchall():
        due = r["due"] or 0
        rn = r["renewed"] or 0
        out.append({
            "label": str(r["label"]), "due": due, "renewed": rn, "pending": due - rn,
            "renewalPct": round(rn / due * 100, 1) if due else 0.0,
            "expectedPremiumGross": _i(r["exp_g"]), "collectedPremiumGross": _i(r["col_g"]),
        })
    return out


def distinct_master(cur, attr) -> list[str]:
    cur.execute(f"SELECT DISTINCT {attr} v FROM {MASTER} WHERE {attr} IS NOT NULL AND {attr} <> '' ORDER BY {attr}")
    return [r["v"] for r in cur.fetchall()]


def distinct_branches(cur) -> list[dict]:
    """Branches with their region, so the UI can cascade Branch from the chosen Region."""
    cur.execute(f"""SELECT DISTINCT RegionName, BranchName FROM {MASTER}
      WHERE BranchName IS NOT NULL AND BranchName <> '' AND RegionName IS NOT NULL AND RegionName <> ''
      ORDER BY BranchName""")
    return [{"name": r["BranchName"], "region": r["RegionName"]} for r in cur.fetchall()]


def trend(cur, where, p, by, src=TABLE) -> list[dict]:
    expr = "CONVERT(varchar(7), policy_exp_date, 23)" if by == "month" else "CONVERT(varchar(10), policy_exp_date, 23)"
    cur.execute(f"""
      SELECT {expr} k, COUNT(*) due, {RENEWED_1} renewed
      FROM {_from(src)}{where} GROUP BY {expr} ORDER BY {expr}""", p)
    return [{"date": r["k"], "due": r["due"] or 0, "renewed": r["renewed"] or 0,
             "pending": (r["due"] or 0) - (r["renewed"] or 0)} for r in cur.fetchall()]


def _split(cur, where, p, expr, src=TABLE) -> list[dict]:
    cur.execute(f"""
      SELECT {expr} label, COUNT(*) due, {RENEWED_1} renewed, SUM(gross_premium) g,
        SUM(CASE WHEN is_renewed = 1 THEN gross_premium ELSE 0 END) cg
      FROM {_from(src)}{where} GROUP BY {expr} ORDER BY COUNT(*) DESC""", p)
    out = []
    for r in cur.fetchall():
        due = r["due"] or 0
        rn = r["renewed"] or 0
        out.append({"label": r["label"], "due": due, "renewed": rn,
                    "renewalPct": round(rn / due * 100, 1) if due else 0.0,
                    "premiumGross": _i(r["g"]), "collectedPremiumGross": _i(r["cg"])})
    return out


def split_platform(cur, where, p, src=TABLE):
    return _split(cur, where, p, PLATFORM, src=src)


def split_channel(cur, where, p, src=TABLE):
    return _split(cur, where, p,
                  "CASE WHEN am_id IS NULL OR am_id = 0 THEN 'Customer Direct' ELSE 'RM Assisted' END",
                  src=src)


def split_segment(cur, where, p, src=TABLE):
    rows = _split(cur, where, p, "sub_product_id", src=src)
    for r in rows:
        sid = r["label"]
        r["label"] = sub_product_name(sid) if sid is not None else "Unknown"
    return rows


def calendar_days(cur, where_no_dates, p, month) -> list[dict]:
    start = f"{month}-01"
    y, m = (int(x) for x in month.split("-"))
    nxt = f"{y + 1}-01-01" if m == 12 else f"{y}-{m + 1:02d}-01"
    w = _and(where_no_dates, "policy_exp_date >= %s AND policy_exp_date < %s")
    cur.execute(f"""
      SELECT CONVERT(varchar(10), policy_exp_date, 23) d, COUNT(*) due, {RENEWED_1} renewed,
        SUM(ISNULL(gross_premium, 0)) g,
        SUM(CASE WHEN is_renewed = 1 THEN ISNULL(gross_premium, 0) ELSE 0 END) cg
      FROM {TABLE} WITH (NOLOCK){w}
      GROUP BY CONVERT(varchar(10), policy_exp_date, 23) ORDER BY d""", p + [start, nxt])
    return [{"date": r["d"], "due": r["due"] or 0, "renewed": r["renewed"] or 0,
             "premiumGross": _i(r["g"]), "collectedPremiumGross": _i(r["cg"])}
            for r in cur.fetchall()]


# ---------- detail list + dropdowns ----------

def policy_rows(cur, where, p, page, page_size, sort_by, desc) -> list[dict]:
    """One page of normalized policy rows, WITHOUT the total count — the CSV export
    loops this per page, and a COUNT(*) on every page would rescan lakhs of rows."""
    col = SORT_COLS.get(sort_by, "policy_exp_date")
    direction = "DESC" if desc else "ASC"
    offset = (page - 1) * page_size
    cols = ", ".join(COLUMNS)
    cur.execute(
        f"SELECT {cols} FROM {TABLE} WITH (NOLOCK){where} "
        f"ORDER BY {col} {direction} OFFSET %s ROWS FETCH NEXT %s ROWS ONLY",
        p + [offset, page_size],
    )
    rows = [record_from_row(r) for r in cur.fetchall()]
    _attach_notice_urls(cur, rows)
    _attach_region_branch(cur, rows)
    return rows


def policies(cur, where, p, page, page_size, sort_by, desc):
    rows = policy_rows(cur, where, p, page, page_size, sort_by, desc)
    cur.execute(f"SELECT COUNT(*) c FROM {TABLE} WITH (NOLOCK){where}", p)
    total = cur.fetchone()["c"]
    return rows, total


def _uid(v) -> int | None:
    """user_id comes through the adapter as a cleaned STRING and may be junk —
    never let one bad row 500 the whole page."""
    try:
        u = int(str(v).strip())
        return u if u > 0 else None
    except (ValueError, TypeError):
        return None


def _attach_region_branch(cur, rows):
    """POSP user_id -> region/branch from vw_master_user, per page (tiny IN-list)."""
    uids = sorted({u for r in rows if (u := _uid(r.get("userId"))) is not None})
    m: dict[int, tuple] = {}
    if uids:
        ph = ",".join(["%s"] * len(uids))
        cur.execute(f"SELECT UserId, RegionName, BranchName FROM {MASTER} WHERE UserId IN ({ph})", uids)
        for r in cur.fetchall():
            m[int(r["UserId"])] = (r["RegionName"], r["BranchName"])
    for r in rows:
        uid = _uid(r.get("userId"))
        reg, br = m.get(uid, (None, None)) if uid else (None, None)
        r["regionName"] = reg or None
        r["branchName"] = br or None


def _attach_notice_urls(cur, rows):
    """Renewal-notice PDF link: renewal.pdf_trn_id -> pdf_read_details.id -> s3_pdf_path.
    Done per page (a tiny IN-list) so it never scans the whole table."""
    # pdfTrnId is already normalized to an int by the adapter (n()), so no casts needed.
    ids = sorted({r["pdfTrnId"] for r in rows if r.get("pdfTrnId")})
    notice: dict[int, str] = {}
    if ids:
        ph = ",".join(["%s"] * len(ids))
        cur.execute(
            f"SELECT id, s3_pdf_path FROM pdf_read_details WITH (NOLOCK) WHERE id IN ({ph})", ids)
        for r in cur.fetchall():
            path = (r["s3_pdf_path"] or "").strip()
            if path:
                notice[int(r["id"])] = path
    for r in rows:
        r["noticeUrl"] = notice.get(r["pdfTrnId"]) if r.get("pdfTrnId") else None


def distinct_expr(cur, expr, where, p, limit=2000, extra="") -> list[str]:
    cond = f"{expr} IS NOT NULL"
    if extra:
        cond += f" AND {extra}"
    cur.execute(
        f"SELECT DISTINCT TOP {int(limit)} {expr} v FROM {TABLE} WITH (NOLOCK)"
        f"{_and(where, cond)} ORDER BY {expr}", p)
    return [str(r["v"]) for r in cur.fetchall() if r["v"] is not None and str(r["v"]).strip()]


def distinct_products(cur, where, p) -> list[dict]:
    """Distinct product_ids present, with their official names (for the dropdown)."""
    cur.execute(
        f"SELECT DISTINCT product_id v FROM {TABLE} WITH (NOLOCK)"
        f"{_and(where, 'product_id IS NOT NULL')} ORDER BY product_id", p)
    out = []
    for r in cur.fetchall():
        pid = r["v"]
        if pid is None:
            continue
        out.append({"id": str(pid), "name": PRODUCT_MAP.get(str(pid), f"Other ({pid})")})
    return out


def distinct_subproducts(cur, where, p) -> list[dict]:
    """Distinct (product, sub-product) pairs present, with names. productId lets the
    UI cascade the sub-product list by the selected product.

    The four official Health sub-products are ALWAYS listed (even when the current
    data window has no rows for one of them); ids found in the data beyond those
    are appended after, labelled by their raw id."""
    out = [{"id": sid, "name": name, "productId": "1"}
           for sid, name in HEALTH_SUB_PRODUCT_MAP.items()]
    seeded = {(o["productId"], o["id"]) for o in out}
    cur.execute(
        f"SELECT DISTINCT product_id, sub_product_id FROM {TABLE} WITH (NOLOCK)"
        f"{_and(where, 'sub_product_id IS NOT NULL')} ORDER BY sub_product_id", p)
    for r in cur.fetchall():
        sid = r["sub_product_id"]
        if sid is None:
            continue
        pid = str(r["product_id"]) if r["product_id"] is not None else ""
        if (pid, str(sid)) in seeded:
            continue
        out.append({"id": str(sid), "name": sub_product_name(sid), "productId": pid})
    return out
