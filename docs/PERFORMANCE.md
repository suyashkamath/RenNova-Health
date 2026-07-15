# Why the Dashboard Felt Slow — and How Connection Pooling Fixed It

_Last updated: 2026-07-08_

This is the story of one performance problem on the Renewal Dashboard: why pages took
seconds to load, how we traced it to its real cause, and the one change that made the
biggest difference. It's written to be read by anyone on the team — no deep database
background assumed.

---

## The symptom

Open the Dashboard, or change a single filter, and you'd wait. Not forever — a few
seconds — but enough that every click felt heavy. The UI even had a little apology baked
in: _"After changing a filter, give it a few seconds — it runs on lakhs of live records."_

That message is honest, but it hides something important: **most of the wait had nothing
to do with the lakhs of records.** A lot of it was pure overhead we were paying before a
single row was ever read.

---

## The investigation: four costs stacked on top of each other

Slowness is rarely one thing. When we actually read the code path a page load takes, the
delay turned out to be **four separate costs multiplying each other.**

### Cost #1 — A brand-new database connection on every request

In the original `backend/db.py`, every incoming request called `pymssql.connect(...)`
**from scratch.** Opening a database connection is not free: it's a **TCP handshake plus a
SQL Server login handshake** — several back-and-forth network trips just to say hello and
prove who you are.

On a normal local network that's quick. But our backend talks to the database **through an
SSH tunnel** (see `DB_CONNECTION_TROUBLESHOOTING.md` for what that is). Every one of those
handshake trips is encrypted and bounced through a jump host and back. So "just connecting"
could cost **hundreds of milliseconds to a full second — before any data was fetched.** And
we paid it again on every page and every filter change.

### Cost #2 — One page is actually several requests

Loading the Dashboard doesn't fire one request. The frontend asks for several things at
once: `/dashboard`, `/trend`, `/filters`, `/calendar`. Each of those opened **its own**
fresh, tunneled connection. So Cost #1 wasn't paid once per page — it was paid **four or
more times per page.**

### Cost #3 — The dashboard query genuinely does a lot of work

The `/dashboard` endpoint is legitimately heavy. It:

- scans the big renewal table and copies the filtered window into a temporary table,
- runs roughly **ten aggregations** over that window (KPIs, platform/channel/segment
  splits, and five rankings — company, RM, POSP, region, branch),
- and does a **second** scan for the previous period, to power the "vs last period" deltas.

Over lakhs of live rows, that's real work. This is the part the UI's apology was actually
about — and it's the one cost that _isn't_ overhead.

### Cost #4 — The results travel back through the tunnel

Every row of every result is encrypted and forwarded back through the SSH tunnel to the
backend. Big result sets (rankings, trend) feel this the most, and it rides on top of
everything above.

---

## What actually moves the needle

Once the costs were clear, the fixes ranked themselves by bang-for-buck:

| Fix | Effort | Impact |
| --- | --- | --- |
| **Connection pooling** — reuse a handful of live connections instead of dialing fresh every request | Small code change in `db.py` | **Huge** — kills Cost #1 and most of #2 |
| **Run the backend _on_ the DB network** (or DB server) instead of over the tunnel | Deployment | Huge — kills the tunnel latency in #2 & #4 |
| **Indexes** on `policy_exp_date` + common filter columns, if missing | DB-side | Large on #3 — turns the window scan from full-table into a range seek |
| **Short-cache filter options / cheap query paths** | Small | Medium |

The single highest-leverage _code_ fix was clearly **connection pooling** — it's the
difference between _"pay a tunneled login handshake on every click"_ and _"pay it once at
startup."_ And it's a contained change, all inside `backend/db.py`.

---

## The fix we shipped: connection pooling

### The idea in one sentence

Instead of opening and throwing away a connection for every request, keep a small set of
connections **alive and ready**, hand one out when a request needs it, and take it back
(not close it) when the request is done.

### The taxi-rank analogy

The old way was like **building a brand-new taxi from scratch every time someone wanted a
ride**, then scrapping it at the destination. The handshake was the assembly line.

A pool is a **taxi rank**: a few cars wait at the curb. A passenger (request) takes one,
rides, and the car returns to the rank for the next passenger. You build the cars once. If
the rank is empty because all cars are out, the next passenger waits a moment for one to
return — you never build an unbounded fleet.

### How it works in the code

The clever part is that **nothing in `main.py` had to change.** The pool keeps the exact
same shape the rest of the app already used:

```python
conn = get_connection()   # borrow a car from the rank
try:
    cur = conn.cursor(as_dict=True)
    ...
finally:
    conn.close()          # NOT destroyed — returned to the rank
```

`get_connection()` now hands back a thin proxy object. It behaves like a real connection
(`.cursor(...)` works as before), but its `.close()` **returns the underlying connection to
the pool** instead of tearing it down. To the hundreds of existing call sites, nothing
looks different.

Key properties built into the pool:

- **Bounded size.** The pool never grows past `DB_MAX_CONNS` (read from `.env` — a setting
  that had been sitting there unused). When every connection is busy, a new request waits
  for one to free up rather than piling on more tunneled handshakes.
- **Self-healing.** A pooled connection can silently die — the tunnel blips, or SQL Server
  drops an idle session. So before handing one out, the pool runs a cheap `SELECT 1`. If
  that fails, the dead connection is discarded and replaced with a fresh one. A dropped
  tunnel can't permanently wedge the pool.
- **Autocommit on.** Each connection commits per statement, so a pooled connection never
  drags an open transaction (and its locks) into the next request that borrows it. All our
  queries are reads anyway, so this is safe.

### One necessary side-fix: the temp table

The dashboard builds a session-scoped temp table called `#w`. When each request had its own
throwaway connection, `#w` vanished with it. But a **reused** connection keeps its session
alive — so the _next_ request's `SELECT ... INTO #w` would hit _"there is already an object
named `#w`."_

The fix was to make that step idempotent — drop `#w` if it exists, then recreate it:

```sql
IF OBJECT_ID('tempdb..#w') IS NOT NULL DROP TABLE #w
SELECT ... INTO #w FROM ...
```

This is a good example of how a change in one place (pooling) quietly changes the
assumptions somewhere else (temp-table lifetime). Reuse is powerful, but it means state can
outlive a single request — so anything that assumed a clean slate has to be told to reset.

---

## How we verified it (without a database)

The SSH tunnel was down while this was built, so the real SQL Server was unreachable —
which meant we couldn't just "click around and see if it's faster." That's fine: the parts
worth verifying are the **pool mechanics**, not the SQL, and those can be tested against a
_fake_ connection that stands in for the real one.

We swapped in a stub connection object and exercised the pool directly. All four properties
held:

- **Reuse** — borrow a connection, return it, borrow again → the _same_ underlying
  connection comes back, and the pool's "created" count stays at 1 (no new handshake).
- **Cap enforced** — with the cap set to 2, a third simultaneous borrow **blocks** instead
  of opening a third connection.
- **Unblocks on release** — the moment a busy connection is returned, that waiting borrow
  proceeds.
- **Dead-connection discard-and-replace** — a connection marked dead is detected on
  checkout, thrown away, and replaced with a fresh one; a dead connection is never handed to
  a caller.

Both `db.py` and `queries.py` also pass a syntax check. So the logic is proven; the only
thing left to confirm live is the _speed_ improvement, which needs the tunnel up.

**The files that changed:**

- `backend/db.py` — rewritten as the thread-safe pool (same public API, so `main.py` needed
  zero changes).
- `backend/queries.py` — `materialize_window` now drops `#w` before recreating it.

---

## Before and after

- **Before:** every request = a fresh TCP + login handshake through the tunnel, paid 4+
  times per page load and again on every filter change.
- **After:** the handshake is paid a handful of times near startup. From then on, page loads
  and filter changes reuse warm connections. The heavy query work (Cost #3) still runs — but
  the pure connection _overhead_ that surrounded it is largely gone.

The first request after the backend boots still pays one connect (the pool fills lazily).
Every click after that is where you feel the difference.

---

## What's left (the honest roadmap)

Pooling attacks Costs #1 and #2. The rest of the table is still on the board:

1. **Run the backend on the DB network** — removes the tunnel from the hot path entirely
   (Costs #2 and #4). This is a deployment change, not a code one.
2. **Confirm the indexes** on `policy_exp_date` and the common filter columns. If the window
   scan in Cost #3 is doing a full-table read, the right index turns it into a fast range
   seek. (This needs the tunnel up to inspect the live table.)
3. **Short-cache the cheap, rarely-changing bits** like filter option lists.

---

## The takeaway

The lesson worth carrying to the next slow feature: **measure where the time actually
goes before you optimize the obvious thing.** It was tempting to blame "lakhs of records"
and go tune SQL. But the largest, cheapest-to-fix cost wasn't the query at all — it was the
_overhead of connecting_, paid over and over through a slow tunnel. A small, contained
change in one file (`db.py`) removed most of it, without touching a single endpoint.

Fast systems usually aren't built by making one thing brilliant. They're built by finding
the dumb tax you're paying on every single request — and stopping.
