# Database Connection & SSH Tunnel — Troubleshooting Guide

_Last updated: 2026-07-08_

This is the single most common reason the dashboard "breaks" on a developer's machine.
**It is almost never a code bug.** It is a *connectivity* problem: the backend cannot
reach the database. This document explains the whole concept from scratch — slowly and
in plain language — so anyone on the team can diagnose and fix it without help.

---

## 1. The one-line summary

> Every page (Dashboard, Policy List, Calendar) asks the backend for data.
> The backend asks **SQL Server** for that data.
> If the backend cannot *reach* SQL Server, the request dies with a **500 Internal
> Server Error** and a message like _"Adaptive Server is unavailable or does not exist"_.

That error means: **"I tried to phone the database, and nobody picked up."**

---

## 2. What the error looks like

```
GET /api/dashboard?... HTTP/1.1  500 Internal Server Error
pymssql._mssql.MSSQLDatabaseException: (20009, b'DB-Lib error message 20009 ...
Unable to connect: Adaptive Server is unavailable or does not exist (127.0.0.2)
Net-Lib error during Operation timed out (60)')
```

Read it like a human, not a computer:

| Piece of the error            | What it actually means                                             |
| ----------------------------- | ------------------------------------------------------------------ |
| `Unable to connect`           | The backend never reached a database at all.                       |
| `Adaptive Server`             | Old name for SQL Server. Just means "the database".                |
| `(127.0.0.2)`                 | The address it *tried* to connect to.                              |
| `Operation timed out (60)`    | It waited 60 seconds, heard nothing back, and gave up.             |
| `500 Internal Server Error`   | The backend crashed *while handling the request* (because of ^).   |

Key insight: **the search feature, the dashboard code, the filters — none of that ran.**
The very first step, "open a connection to the database," failed. So this can never be
caused by a frontend or query change. It is purely about whether the DB is reachable.

---

## 3. The concept: why the address is `127.0.0.2` (this is the important part)

To understand the fix, you need one idea: **the database does not live on your laptop.**

The real SQL Server lives on a **production server** inside Probus's private network, at
an address like `172.31.21.121`. That server is **not** open to the public internet — you
cannot connect to it directly from home or from a coffee shop. That's on purpose: it keeps
company data safe.

So how does your laptop, which is *outside* that private network, talk to a database
*inside* it? The answer is an **SSH tunnel**.

### 3.1 What an SSH tunnel is (the pipe analogy)

Imagine the production database is a building with **no public entrance**. But there is a
**guarded gate** (a "jump host" / "bastion server") that *is* reachable, and you have a key
to that gate (your SSH login).

An SSH tunnel is like this:

```
   YOUR LAPTOP                    THE GUARDED GATE                 THE DATABASE
  (outside network)               (jump / bastion host)          (inside network)

  127.0.0.2:10067  ══════════════════════════════════════════►  172.31.21.121:1433
       │            one secure, encrypted "pipe" over SSH             │
       │                                                              │
   You talk to a         The tunnel carries your words         The database answers
   "fake" local door     through the gate...                  as if you were inside.
```

You tell your laptop: _"Whenever I knock on the local door `127.0.0.2:10067`, secretly
carry that knock through the SSH gate and deliver it to the real database at
`172.31.21.121:1433`."_

- `127.0.0.2:10067` = a **pretend local address** on your own machine (a "loopback"
  address — see §3.2). It is the *entrance to the pipe*.
- `172.31.21.121:1433` = the **real database** on the far end. `1433` is the standard
  SQL Server port.

So when the backend connects to `127.0.0.2:10067`, it *thinks* it's talking to a local
database — but the tunnel is quietly forwarding everything to the real one far away.

### 3.2 Why `127.0.0.2` and not `127.0.0.1`?

`127.0.0.x` addresses all mean **"this same computer"** (localhost). `127.0.0.1` is the
famous one. `127.0.0.2` is just *another* loopback address on your own machine — teams
often use a slightly different one so a tunnel doesn't clash with some *other* local
database you might also be running on `127.0.0.1`. Functionally: **both point back at your
own laptop.** They are only useful if *something* (the tunnel) is listening there.

### 3.3 Why "the tunnel is down" breaks everything

If the tunnel is **not running**, then nobody is listening at `127.0.0.2:10067`. The
backend knocks on that local door... and there's no pipe behind it. It waits 60 seconds,
gives up, and you get the timeout error. **The database itself is perfectly healthy — you
just have no way to reach it.**

---

## 4. Where the address comes from — `backend/.env`

The backend reads its connection settings from `backend/.env` (see `backend/db.py`).
That file has two blocks — a **Local** one (via tunnel) and a commented-out **Production**
one (direct):

```ini
#  Production   (direct — only works when you're ON the private network / VPN)
# MSSQL_SERVER=172.31.21.121
# MSSQL_DATABASE=probus_web_live

# Local   (via SSH tunnel — the loopback address + forwarded port)
MSSQL_SERVER=127.0.0.2,10067
MSSQL_USER=ai_dev
MSSQL_PASSWORD=********
MSSQL_DATABASE=probus_autoboat_live
```

Note `MSSQL_SERVER=127.0.0.2,10067`. In SQL Server's world, `host,port` (comma, not colon)
means "connect to this host on this port." `db.py` splits on the comma and passes the port
to `pymssql`. So this line literally says: **"connect to my own machine on port 10067"** —
which only works if the tunnel is alive.

---

## 5. How to DIAGNOSE it (copy-paste these)

Run these in a terminal. They tell you *for sure* whether the tunnel is the problem.

**a) Is anything listening on the tunnel port?**
```bash
lsof -nP -iTCP:10067 -sTCP:LISTEN
```
- **Prints a line** → something is listening (tunnel is probably up). Good.
- **Prints nothing** → nothing is listening. **This is your problem.** Go to §6.

**b) Is an SSH tunnel process actually running?**
```bash
ps aux | grep "ssh" | grep -v grep
```
- Look for a line containing `-L` and `10067`. If there's no such line, the tunnel is down.

---

## 6. How to FIX it — pick one

### Option A — Restart the SSH tunnel (the usual fix)

Run the tunnel command in its **own terminal window** and **leave it open**. It looks like:

```bash
ssh -L 127.0.0.2:10067:172.31.21.121:1433 <your-user>@<jump-host>
```

Reading that command:
- `-L` = "set up a **L**ocal port-forward" (this is the tunnel).
- `127.0.0.2:10067` = the local door to open on your machine.
- `172.31.21.121:1433` = where to secretly deliver the traffic (the real DB).
- `<your-user>@<jump-host>` = the gate you log into and your username on it.

> ⚠️ You must keep that terminal open. Closing it closes the pipe, and the error returns.
> If the command exits immediately or asks for a password/key you don't have, ask whoever
> set up your environment for the exact jump-host address and credentials.

After the tunnel is up, just **retry the page** — no backend restart needed.

### Option B — Connect directly to production (only on VPN / same network)

If you are on the company VPN or physically on the same network as `172.31.21.121`, you
can skip the tunnel. Edit `backend/.env`:

```ini
MSSQL_SERVER=172.31.21.121
MSSQL_DATABASE=probus_web_live
```

Then **restart the backend** so it re-reads `.env`. Use this only when you genuinely have
network access to that IP — otherwise you'll get the same timeout.

---

## 7. Mental model to remember forever

```
  Browser ──► FastAPI backend ──► [ 127.0.0.2:10067 ] ──► SSH tunnel ──► real SQL Server
                                        ▲
                                        │
                          If NOTHING is listening here,
                          the whole chain times out → 500 error.
                          The fix is (almost) always: bring the tunnel back up.
```

If you see **"Adaptive Server is unavailable"** / a 500 on every data page, don't go
hunting through the code. Do this instead:

1. `lsof -nP -iTCP:10067 -sTCP:LISTEN` — is anything listening?
2. If not → restart the SSH tunnel (§6, Option A).
3. Retry the page.

That's it. 95% of the time, that's the whole fix.
