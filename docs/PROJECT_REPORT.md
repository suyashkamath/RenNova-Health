# Renewal Dashboard — Project Report

**For:** Founder / management review
**Status:** Working prototype, running on **SAMPLE data**
**Goal:** A live dashboard that shows the health of motor-insurance renewals — what's
due, what's renewed, what's pending, who's performing — so the team can act daily.

---

## 1. The one-line summary

> We have built a **fully working renewal dashboard**. Right now it runs on **sample
> (dummy) data** that we created to look exactly like the real data. To go live, we
> only need to **plug in the real data** — nothing else in the app has to change.

Think of it like a **car that's fully built and driving on a test track with a test


---

## 2. What is "sample data"? (Important)

- The dashboard needs data to show numbers. The **real data** comes from Binal Ma'am's
  system (the renewal database / stored procedure).
- Since the real data wasn't connected yet, we **generated realistic sample data** —
  about **21,000 dummy policies** spread across 6 months — that has the **exact same
  36 columns** as the real renewal data.
- Every number you see on the dashboard today is calculated from this **sample file**.
- **To go live:** replace the sample file with the real data feed. Because the format
  is identical, **the dashboard will just work** with real numbers.

> 📌 In short: **the dashboard is done; only the data source needs to be switched from
> sample to real.**

---

## 3. What the dashboard shows (the features)

**Top numbers (KPIs):**
- Renewals **Due** (how many policies are up for renewal)
- **Renewed** (how many were successfully renewed)
- **Pending / Lapsed** (not yet renewed)
- **Renewal %** (success rate)
- **Expected Premium** (money we expect) — shown as both *net* (without tax) and *gross* (with tax)
- **Collected Premium** (money actually collected from renewed policies)
- **Payment link available** and **Renewal notice available** counts

**Visual sections:**
- **Trend chart** — renewals over time (daily or monthly)
- **Renewal Calendar** — a month view; each day is colour-coded (green = good, red = low,
  grey = future). **Click any day → see that day's policy list.**
- **Reminder buckets** — how many renewals are due in the next 3 / 7 / 15 / 30 / 45 days
  (so the team knows whom to contact next)
- **Performance rankings** — best/worst by **Insurance Company**, **Relationship Manager (RM)**,
  and **POSP (agent)**
- **Splits** — Online vs Offline, RM-handled vs Customer-direct, and by vehicle segment

**Policy List page:**
- A searchable, filterable table of every policy
- Filters: date, company, segment, RM, platform, channel, status, etc.
- **Export to Excel/CSV** for follow-up
- Click-through from any chart or calendar day lands here, pre-filtered

---

## 4. How it was built — in simple language

A dashboard has **two parts** that talk to each other:

### A. The Backend (the "engine room") — built with **FastAPI (Python)**
- **Job:** read the data, do all the maths, and hand clean numbers to the screen.
- **What it does, step by step:**
  1. **Reads** the renewal data file.
  2. **Cleans** it — fixes dates, blanks, and number formats so everything is reliable.
  3. **Calculates** all the KPIs, rankings, trends, and calendar numbers.
  4. **Serves** these numbers over a simple web link (an "API") that the screen can ask for.
- **Why this matters:** all the heavy counting happens here, not on the user's screen,
  so it stays fast even with large data.

### B. The Frontend (the "dashboard you see") — built with **Angular**
- **Job:** take the numbers from the backend and show them as cards, charts, the calendar,
  and tables — and let the user filter, click, and export.
- **What the user experiences:** pick filters → the screen instantly asks the engine room
  for the matching numbers → shows updated cards and charts.

### How they work together (the data's journey)
```
Renewal data  →  Backend reads & cleans it  →  Backend calculates KPIs
              →  Frontend asks for them      →  User sees cards, charts, calendar, tables
```

---

## 5. Why the numbers can be trusted

- Every KPI is a **direct count or sum of the actual rows** — nothing is faked or estimated.
- The **same filter logic** powers both the summary cards *and* the detailed policy list,
  so the totals on top **always match** the rows underneath. Click "Pending" and you see
  exactly those pending policies.
- We **verified** the sample numbers reconcile (e.g. total policies, renewed count, premium
  totals all tally with the source file).

---

## 6. What's needed to go live (the only remaining step)

1. **Get the real data** from Binal Ma'am — ideally as the **two stored procedures**
   we requested (one for summary, one for the detailed list), or the renewal table.
2. **Point the backend at it** — we replace the single "read the sample file" step with
   "read from the real database." *(One file changes; the rest stays as-is.)*
3. **Map Region & Branch** — these aren't in the 36 columns, so they come from the
   master-user table (joined on user/RM/POSP id), as already documented.
4. Done — the same dashboard now shows **live, real numbers**.

---

## 7. Technology used (for reference)

| Part | Technology | In plain terms |
|---|---|---|
| Frontend (the screen) | Angular | Builds the interactive dashboard |
| Backend (the engine) | FastAPI (Python) | Reads data, does the maths, serves numbers |
| Data (now) | Excel sample file | Stand-in for real data, same 36 columns |
| Data (later) | Database / stored procedure | The real renewal data |

---

## 8. Bottom line for the founder

- ✅ The dashboard is **built and working end-to-end**.
- ✅ It already does **everything the business asked for** — due/renewed/pending, premium,
  rankings, calendar, reminders, drill-down, export.
- 🔄 It currently runs on **sample data** that mirrors the real format exactly.
- ➡️ **Going live = swapping sample data for real data.** No redesign, no rebuild.
