# Renewal Dashboard — Data Request & Column Mapping

**Purpose:** This document defines exactly what data the dashboard needs from the
36-column renewal dataset, and what to request from Binal Ma'am (stored procedures
or tables) so the dashboard runs on **real data** instead of mock data.

> **Update (final cut):** Binal Ma'am trimmed the dataset from 40 → 36 columns.
> **Removed:** `agent_id`, `rm_code`, `is_file_removed_on_s3`, `is_renewed_check`.
> POSP is now keyed by `user_id`, RM by `rm_name` + `am_id`, notice availability by
> `pdf_trn_id` alone, and renewal status by `is_renewed` alone.

**Guiding instruction (from Sir):** We do *not* need to model the full renewal
business flow. We only need to **display things from this data**, according to the
existing UI.

---

## 0. The 36 columns provided

```
id, pdf_trn_id, control_no, company_name, policy_type, policy_no, issue_date,
policy_start_date, policy_exp_date, platform, insured_name, cust_email, cust_mobile,
vehicle_regi_no, user_id, pos_name, pos_email, pos_mobile, am_id,
rm_name, rm_email, rm_mobile, company_id, entry_on,
payment_link, updated_on, is_renewed, vertical_name, sum_insured,
net_premium, gross_premium, make, chasis_no, engine_no, product_id, sub_product_id
```

---

## 1. Column → UI mapping (what each part of the dashboard uses)

| Dashboard element | Columns / logic |
|---|---|
| KPI: Due | `COUNT(*)` where `policy_exp_date` in selected range |
| KPI: Renewed | `COUNT` where `is_renewed = 1` |
| KPI: Pending / Lapsed | Due − Renewed |
| KPI: Renewal % | Renewed / Due × 100 |
| KPI: Expected Premium | `SUM(gross_premium)` for due (gross = with tax). Also expose `SUM(net_premium)` (net = without tax). |
| KPI: Collected Premium | `SUM(gross_premium)` where `is_renewed = 1` (net available too) |
| KPI: Payment link available | `COUNT` where `payment_link` not null/empty |
| KPI: Notice available | `COUNT` where `pdf_trn_id > 0` |
| Renewal notice link | built from **`pdf_trn_id` + `control_no`** together (both needed) |
| Company ranking | `company_id`, `company_name` |
| RM ranking | `rm_name`, `am_id` (no `rm_code`; region/branch via master-user join) |
| POSP ranking | `user_id`, `pos_name` (no `agent_id`) |
| Vertical / Product filter | `vertical_name`, `product_id`, `sub_product_id` |
| Platform filter | `platform` |
| Trend chart (daily/monthly) | group by `policy_exp_date` |
| Future calendar / reminder buckets | `policy_exp_date` vs today (45/30/15/7/3/1 day) |
| Policy detail list | `policy_no, insured_name, cust_mobile, vehicle_regi_no, company_name, policy_type, policy_exp_date, rm_name, pos_name, net_premium, gross_premium, payment_link, is_renewed` |

### 1a. Field semantics / business rules (from Sir)

- **Renewal notice link** needs **both `pdf_trn_id` and `control_no`** — neither alone
  is enough to fetch/build the notice link.
- **`platform`** = where the renewal happened:
  - `ONLINE`  → via our **Probus Insurance broker platform**
  - `OFFLINE` → directly on the **insurance company's** platform
- **`am_id`** = who actioned the renewal:
  - `0`   → **customer renewed directly** (manual, no RM involved)
  - `≠ 0` → **RM did it** (`am_id` identifies the RM/area manager)

---

## 2. Gaps — NOT present in the 36 columns ⚠️

The UI has these, but the data does not carry them. They come from the **master
user table**, joined on the IDs we already have:

1. **Region** — ✅ resolved: join master-user on `user_id` (or `rm_id` / `pos_id`)
2. **Branch** — ✅ resolved: same master-user join
3. **Product / Sub-product NAMES** — only `product_id` / `sub_product_id` (numbers)
   are provided, not text labels → need product master for the labels

---

## 3. Preferred request: TWO stored procedures (count + detail)

### SP 1 — Summary (KPI cards + rankings + trend)
```
EXEC sp_renewal_dashboard_summary
    @from_exp_date, @to_exp_date,
    @company_id    = NULL,
    @rm_code       = NULL,
    @agent_id      = NULL,
    @vertical_name = NULL,
    @product_id    = NULL,
    @platform      = NULL,
    @group_by      = 'company'|'rm'|'posp'|'vertical'|'product'|'platform'|'day'|'month'

-- returns per group:
group_label, due_count, renewed_count, pending_count, renewal_pct,
expected_premium, collected_premium, payment_link_count, notice_available_count,
region, branch          ← please add these
```

### SP 2 — Detail list (policy table + Excel export)
```
EXEC sp_renewal_dashboard_list
    @from_exp_date, @to_exp_date, [same filters as above],
    @is_renewed       = NULL,   -- 1 = renewed, 0 = pending
    @has_payment_link = NULL,
    @has_notice       = NULL,
    @page = 1, @page_size = 50

-- returns the policy-level rows (the columns above) + total_count
```

**Why two:** the summary SP is fast (DB does the counting, good for cards/charts);
the detail SP is for drill-down and export. This is the "count ke hisaab se /
detail ke hisaab se" split.

---

## 4. Fallback: if stored procedures are not possible, ask for these tables

| Table | Why needed |
|---|---|
| Main renewal table (the 36 columns) | The actual data |
| Master user (`user_id` / `rm_id` / `pos_id` → **region, branch**, names) | Fills region/branch gap |
| Product master (`product_id`, `sub_product_id` → names) | Show product names, not IDs |

(Company name is already available via `company_name`.)

---

## 5. Critical: total dump + renewed in ONE source

Do **not** take two separate files (one "due", one "renewed"). Request **one
table/SP that contains ALL eligible renewals with the `is_renewed` flag inside it**,
so Renewal % = renewed ÷ eligible is computed correctly and reconciles.

---

## 6. Open questions to confirm with Ma'am

**Resolved:**
- ✅ Renewal status = **`is_renewed`** only (`is_renewed_check` removed from dataset).
- ✅ Premium: **`net_premium`** = pure premium (without tax), **`gross_premium`** =
  premium with tax. Both carried; KPIs default to gross, net shown alongside.
- ✅ Region & branch come from the **master-user table** (join on `user_id` /
  `rm_id` / `pos_id`).

**Still open:**
1. Should cancelled / declined / rejected policies be excluded from "Due"?

---

## 7. Ready-to-send message (for Ma'am)

> Ma'am, dashboard ke liye final 36-column renewal data mil gaya. Display ke liye 2
> cheezein chahiye:
>
> **1. Ek summary stored procedure** — date range + company/RM/POSP/vertical/product
> filters le, aur group-by (`company`/`rm`/`posp`/`vertical`/`product`/`day`/`month`)
> ke hisaab se counts de: due, renewed, pending, renewal %, expected premium,
> collected premium, payment-link count, notice-available count.
>
> **2. Ek detail stored procedure** — same filters + pagination le aur policy-level
> rows de (export ke liye).
>
> Dono mein please **region aur branch** bhi add kar dijiye (master-user se
> `user_id`/`rm_id`/`pos_id` pe join karke), aur **product/sub-product ke naam**
> (sirf ID nahi). Renewal % ke liye **eligible + renewed dono ek hi source mein**
> (is_renewed flag ke saath) chahiye.
>
> Agar SP possible nahi, to renewal table ke saath **master-user table aur
> product master** de dijiye — main `user_id`/`rm_id`/`pos_id` pe join kar lunga.
