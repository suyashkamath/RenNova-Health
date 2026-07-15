# Renewal vs Rollover — Can we show it? How?

**Short answer: YES, it can be derived.** SAIBA does not *store* it anywhere, but the
data needed to work it out is present in `saiba_renewal_transaction_data`.

---

## 1. The question

Madam / team asked: renewal ko **"straight renewal" vs "rollover"** me split kar sakte hain?

- **Renewal (retention)** — policy renewed with the **same insurer** (insurer didn't change).
- **Rollover** — policy renewed but the customer **switched to a different insurer**
  (insurer A → insurer B). Very common in motor.

Both have `is_renewed = 1`. The only difference is **whether the insurer changed** between
the expiring policy and the new one.

---

## 2. What SAIBA has / does NOT have (verified against the live DB)

| Thing | Present? | Notes |
|---|---|---|
| **Old / current insurer** (the expiring policy's company) | ✅ Yes | `company_id` / `company_name` on the row = the "prev company" Madam mentioned. |
| **New insurer** (where the renewal was done) | ❌ Not stored | No `new_company_id`, no `renewal_type` / `business_type`, no `is_rollover` column. |
| `renew_ot_id` (looked like a link to the renewed txn) | ⚠️ Empty | Column exists but is **NULL/0 in all 4.8M rows** — unusable. |

> Confirmed by Binal ma'am: *"aisa nahi ki nahi dikha sakte, lekin hum kahin maintain
> nahi karte. Online business pe same vehicle-no se kar sakte ho, but nvarchar data pe
> query server ke liye too heavy hai."* — exactly matches the findings below.

---

## 3. Why it's still derivable

When a policy is renewed, the **new policy appears as its own row in the same table** —
same vehicle, `policy_start_date` right after the old policy's expiry.

**Live proof** (pulled from `saiba_renewal_transaction_data`, `probus_autoboat_live`):

```
=== DL08CT7304 ===
  6203055041          company_id= 9  TATA-AIG GENERAL INSURANCE   start=2024-06-27 exp=2025-06-26  is_renewed=True
  201510000025700684  company_id=18  LIBERTY VIDEOCON GENERAL     start=2025-06-27 exp=2026-06-26  is_renewed=False
      -> next insurer differs (TATA-AIG -> Liberty)  =  ROLLOVER

=== RJ04CA4314 ===
  402000181035        company_id=45  ZUNO GENERAL INSURANCE       start=2024-04-09 exp=2025-04-08  is_renewed=True
  271000312519005720  company_id=21  NATIONAL INSURANCE CO.       start=2025-04-15 exp=2026-04-14  is_renewed=False
      -> next insurer differs (ZUNO -> National)     =  ROLLOVER

=== UP78FP3482 ===
  D134247086          company_id=41  Go Digit General Insurance   start=2024-02-05 exp=2025-02-04  is_renewed=True
  D185261025          company_id=41  Go Digit General Insurance   start=2025-02-05 exp=2026-02-04  is_renewed=False
      -> next insurer same (Go Digit -> Go Digit)    =  RENEWAL (retention)
```

**The rule:**
1. Take the vehicle's policies ordered by `policy_exp_date`.
2. For a row with `is_renewed = 1`, find the **next policy** for the same vehicle
   (`policy_start_date` ≈ old `policy_exp_date` + 1 day → high confidence it's the renewal).
3. Compare insurers:
   - same `company_id` → **Renewal (same insurer)**
   - different `company_id` → **Rollover (switched insurer)**

> This is an **inference**, not a SAIBA-stored fact. It works, but see the constraints.

---

## 4. Constraints (must tell the team)

1. **Only reliable for MOTOR** — the match key is `vehicle_regi_no`. Health/Life/etc.
   have no vehicle number, so they'd need a different link (e.g. `control_no`).
2. **`vehicle_regi_no` needs cleaning** — strip `-` and spaces
   (`REPLACE(REPLACE(vehicle_regi_no,'-',''),' ','')`), same as SAIBA's own queries.
3. **Performance (Madam's concern):** `vehicle_regi_no` is `nvarchar` and the cleaned
   form has **no index** → a naive self-join over all 4.8M rows does a full scan per row
   and times out. This must NOT run live on the whole table.

---

## 5. How to make it fast (solve the "query too heavy" problem)

Do **not** self-join the full table live. Options, best-first:

**A. Bound the outer set first (cheapest, no schema change).**
Compute rollover only for the **current renewal window** (the ~45-day Due set) and,
as Madam suggested, only for **online business** (`platform = 'ONLINE'`) + `product_id = 2`.
The outer set becomes a few thousand rows, not millions — the per-row lookup is then tolerable.

**B. Persisted computed column + index (best for production, needs DBA / Madam OK).**
```sql
ALTER TABLE saiba_renewal_transaction_data
  ADD veh_clean AS (REPLACE(REPLACE(vehicle_regi_no,'-',''),' ','')) PERSISTED;
CREATE NONCLUSTERED INDEX ix_veh_clean_exp
  ON saiba_renewal_transaction_data (veh_clean, policy_exp_date) INCLUDE (company_id);
```
Then the "next policy" lookup is an index seek → fast even at full scale.

**C. Nightly batch -> store the result.**
A scheduled job computes a `rollover` flag (renewal / rollover / unknown) for renewed
motor rows and writes it to a small side table. The dashboard just reads that column —
zero heavy queries at request time.

---

## 6. One-line for Madam

> Old (current) insurer toh data me hai hi. New/rollover insurer SAIBA store nahi karta,
> par renewed policy **same table me next row** hoti hai — uska insurer compare karke
> rollover derive kar sakte hain (online + motor, vehicle-no se). Heavy nvarchar scan se
> bachne ke liye ya toh window/online pe bound karke chalayenge, ya ek indexed
> `veh_clean` column / nightly batch bana denge.
