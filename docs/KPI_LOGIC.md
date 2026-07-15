# How the KPIs Work — Data Flow & Drill-Down

A brief explanation of how raw Excel rows become the numbers you see on the dashboard.

---

## 1. The pipeline (where the drilling happens)

```text
Excel (36 columns)
   │   backend/src/adapter.ts   ── clean + normalize each row
   ▼
RenewalRecord[]  (one tidy object per policy, with derived fields)
   │   backend/src/aggregations.ts ── filter, then count/sum/group
   ▼
/api/dashboard JSON  (KPIs, trend, buckets, splits, rankings)
   │   frontend service + signals
   ▼
KPI cards / charts / tables on screen
```

Every number is computed **on the server, over the filtered set of rows** — nothing is
hard-coded or mocked. Change a filter → the row set shrinks → every KPI recomputes.

---

## 2. Step 1 — Normalize (the "drill" starts here)

`adapter.ts` reads the sheet and turns each messy row into a clean `RenewalRecord`.
This is where raw values become trustworthy fields:

- **Empty handling** — `NULL`, `NA`, `nan`, blank all become `null`.
- **Numbers** — `net_premium`, `gross_premium`, `sum_insured` parsed to real numbers.
- **Dates** — Excel serials / date strings → ISO `yyyy-mm-dd`.
- **Derived fields computed once, here:**

| Derived field | Rule |
|---|---|
| `isRenewed` | `is_renewed == 1` |
| `channel` | `am_id == 0` → `CUSTOMER` (direct), else `RM` |
| `noticeAvailable` | `pdf_trn_id > 0` **AND** `control_no` present |
| `hasPaymentLink` | `payment_link` not empty |
| `segment` | `sub_product_id` → label (10=Two Wheeler, 11=Private Car, …) |

So the "drill-down" is really: **one pass to clean, then group/aggregate on demand.**

---

## 3. Step 2 — Filter (which rows count)

Before any KPI is calculated, `applyFilters()` keeps only the rows matching the active
filters (date range on `policy_exp_date`, company, RM, POSP, platform, segment, channel,
status, search). The KPIs below are always computed over **this filtered set** = `rows`.

---

## 4. Step 3 — The KPI formulas

Computed in `computeKpis()`. `rows` = filtered policies.

| KPI | How it's calculated |
|---|---|
| **Due** | `rows.length` — every policy in the filtered set (expiry in range) |
| **Renewed** | count of `rows` where `isRenewed` |
| **Pending / Lapsed** | `Due − Renewed` |
| **Renewal %** | `Renewed ÷ Due × 100` (rounded to 1 decimal) |
| **Expected Premium (gross)** | `SUM(grossPremium)` over all `rows` — premium *with* tax |
| **Expected Premium (net)** | `SUM(netPremium)` over all `rows` — premium *without* tax |
| **Collected Premium (gross)** | `SUM(grossPremium)` over renewed rows only |
| **Collected Premium (net)** | `SUM(netPremium)` over renewed rows only |
| **Payment Link Available** | count where `hasPaymentLink` |
| **Notice Available** | count where `noticeAvailable` (`pdf_trn_id` + `control_no`) |
| **Online vs Offline** | count by `platform` (ONLINE = Probus, OFFLINE = insurer) |
| **RM vs Customer** | count by `channel` (`am_id`) |
| **Avg Gross Premium** | `Expected Gross ÷ Due` |

---

## 5. Step 3 (cont.) — The grouped views

These reuse the same `rows`, just bucketed by a key:

- **Rankings** (`rank()`) — group rows by `companyName` / `rmName` / `posName`. For each
  group: due, renewed, pending, renewal %, expected & collected premium. Sorted by volume;
  the UI re-sorts by renewal % for Top/Worst.
- **Trend** (`trend()`) — group by `policy_exp_date` (day) or its `yyyy-mm` (month);
  count due & renewed per bucket.
- **Reminder buckets** (`reminderBuckets()`) — over **pending** rows only, compute
  `daysToExpiry = exp_date − today` and drop each into a band: Expired, Today, 1–3, 4–7,
  8–15, 16–30, 31–45, 45+.
- **Splits** (`split()`) — group by platform / channel / segment, with count + renewal %
  + premium per slice.

---

## 6. Drill-down (number → the policies behind it)

The dashboard never dead-ends on a number:

- Click a **reminder bucket** → jumps to the Policy List filtered to **pending** policies.
- Click a **ranking row** → opens the Policy List (carrying the active filters).
- The **Policy List** (`/api/policies`) applies the *same* `applyFilters()` logic, so the
  rows you see are exactly the ones that produced the KPI — they reconcile by construction.
- **Export CSV** dumps that same filtered set for follow-up.

---

## 7. Why it reconciles

Because **one filter function feeds both the KPIs and the detail list**, and every KPI is a
plain count/sum over the same rows, the totals on the cards always equal the rows in the
table. Example with the dummy file (no filters):

```text
Due = 30, Renewed = 20, Pending = 10, Renewal % = 66.7
Expected Gross = ₹5.63 L, Expected Net = ₹4.77 L
Notice Available = 20, Payment Link = 21
```

These match the source Excel exactly — that's the whole point: **the dashboard summarizes
the data, it does not invent it.**
