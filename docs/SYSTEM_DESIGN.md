# Renewal Dashboard — System Design

_Last updated: 2026-07-02_

## 1. What this system is

An internal dashboard over the **live** motor-renewal book (`saiba_renewal_transaction_data`
in `probus_autoboat_live`, ~48 lakh rows). It answers: *what is due, what got renewed,
who is performing, and where is the premium* — sliced by company / product / region /
branch / RM / POSP / platform / channel over an expiry-date window.

```
┌────────────┐   HTTP/JSON    ┌─────────────────┐   pymssql (parameterized SQL)   ┌──────────────────────────┐
│  Angular   │ ─────────────► │  FastAPI        │ ──────────────────────────────► │  SQL Server (live)       │
│  frontend  │ ◄───────────── │  backend        │ ◄────────────────────────────── │  probus_autoboat_live     │
│  (signals) │   aggregates   │  (no row state) │        aggregates only          │  + probus_web_live (users)│
└────────────┘                └─────────────────┘                                 └──────────────────────────┘
```

## 2. Core design decision: aggregate in SQL, never in Python

The backend **never holds the table in memory**. Every number the UI shows is a
`COUNT / SUM / GROUP BY` executed by SQL Server (`backend/queries.py`); the API ships
only small JSON aggregates. This is why the app scales to lakhs of rows on a laptop.

### One scan per request (temp-table materialization)
`/api/dashboard` needs ~11 aggregations (KPIs, trend, buckets, 3 splits, 5 rankings).
Instead of scanning the big table 11×, `materialize_window()` copies the filtered
window **once** into a session temp table `#w` (only the 14 columns aggregations
need), and every aggregation reads `#w`:

```
base table (48L rows) ──[WHERE window+filters, ONE scan]──► #w (~tens of thousands) ──► 11 aggregations
```

### Bounded windows always
`default_window()` guarantees every query has a `policy_exp_date` range — the
renewal cycle `[1st of month M .. 15th of M+1]` (~45 days) unless the user picks
something else. Nothing ever aggregates the unbounded table.

## 3. Read path per endpoint

| Endpoint | Shape | Cost profile |
|---|---|---|
| `/api/dashboard` | 1 scan → `#w` → 11 aggregates + 1 bounded prev-period aggregate | dominated by the one window scan |
| `/api/filters` | 7 faceted `SELECT DISTINCT` on the window + 2 on the user master | small with index |
| `/api/calendar` | 1 `GROUP BY day` over one month | small |
| `/api/policies` | `OFFSET/FETCH` page + `COUNT` + two per-page IN-list lookups (notice PDF, region/branch) | page-sized |
| `/api/policies/export` | streams CSV page-by-page (1000/page) | never holds full set |

Cross-DB joins: region/branch come from `probus_web_live.dbo.vw_master_user`
via `user_id` (POSP). For the policy list this is a per-page IN-list (≤ page size),
not a table-wide join.

## 4. Time presets & "vs last period" deltas (2026-07-02)

**Presets** (frontend only — they just set `from`/`to`, so the server sees one
bounded query exactly like before):

| Preset | Window | Relative cost |
|---|---|---|
| Yesterday | yesterday only | cheapest |
| Weekly | today .. +6d | cheap |
| Monthly | renewal cycle (1st M .. 15th M+1) | the default |
| Quarterly | today .. +89d | ~2× monthly |
| Custom | drag-select in the range calendar | whatever is picked |

The range picker commits only on **Apply** — dragging across days never queries.

**Deltas**: the dashboard also computes the same KPI set for the equal-length
window immediately **before** `[from, to]` (`prev_period()` in `queries.py`):
`1 Jul..15 Aug` (46d) → `16 May..30 Jun`. The frontend renders the % change as a
green-growth / red-dip badge per KPI card ("+12% vs last period"). Direction of
"good" is per-metric (Pending falling = green). Cost: **one** extra bounded
aggregate per dashboard load — same index path as the main query.

## 5. Performance: the index that matters

Measured on the live table (2026-07-02): 4 819 702 rows, and **no index leads with
`policy_exp_date`** — it is the 6th key column of a 2023 composite index, unusable
for a range seek. Consequence: **every dashboard request full-scans 48 lakh rows.**

Fix: `MSSQL/perf_index.sql` — a nonclustered index on `(policy_exp_date)` with
INCLUDE covering all filter/aggregate columns. Turns the scan into a range seek
that reads only the ~45-day window. This is a one-time DBA action, off-peak,
`ONLINE = ON` if Enterprise edition.

Expected effect: dashboard latency drops from "scan 4.8M rows per request" to
"seek + read only the window" — order-of-magnitude improvement; also speeds up
`/api/filters`, `/api/policies`, the export, and the new prev-period aggregate.

Other protections already in place:
- `WITH (NOLOCK)` on the live table — dashboards never block the writers.
- Parameterized SQL everywhere (`%s`), ORDER BY column whitelist (`SORT_COLS`).
- `TOP 50` on rankings, page cap 500, distinct caps — bounded payloads.

## 6. Failure & consistency notes

- **NOLOCK** = read-uncommitted: totals can be off by in-flight writes for a
  moment. Acceptable for a monitoring dashboard; not for accounting.
- The API is stateless — any error is per-request; the frontend keeps last data
  and shows a banner.
- `is_renewed` is written by the upstream SAIBA sync; renewal-vs-rollover is not
  stored (see `docs/ROLLOVER.md`).

## 7. Where things live

```
backend/
  main.py        FastAPI endpoints (thin: parse filters → call queries)
  queries.py     ALL SQL: where-builder, temp-table, aggregations, prev_period
  adapter.py     column contract, product/sub-product masters, row normalization
  db.py          pymssql connection from backend/.env
frontend/src/app/
  components/    filter-bar (presets), date-range-picker (drag-select),
                 kpi-card (delta badges), calendar-widget, charts, rankings
  pages/         dashboard / policies / entity
  services/      renewal.service.ts (one HTTP client, shared filter signal)
MSSQL/
  perf_index.sql covering index for policy_exp_date (run once, off-peak)
```
