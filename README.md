# Renewal Dashboard (Health) — InsureTrack

Full-stack renewal dashboard built from the 36-column renewal dataset.

- **Backend** (`backend/`) — Python + FastAPI. Reads the renewal Excel,
  normalizes it to clean records, and serves KPIs, rankings, trend, reminder
  buckets, calendar, platform/channel splits, and a paginated policy list.
- **Frontend** (`frontend/`) — Angular 21 (standalone, zoneless, signals). Dashboard
  page (KPIs, trend, reminder buckets, splits, rankings) + policy list with filters,
  sorting, pagination, and CSV export.
- **Data** (`data/Renewal_data_MOTOR_dummy.xlsx`) — generated motor dummy data
  following Binal Ma'am's exact 36-column format.

## Run it (two terminals)

**1. Backend** — http://localhost:3000
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --port 3000 --reload
```
Point at a different file with `DATA_FILE=/path/to/file.xlsx uvicorn main:app --port 3000`.
Interactive API docs at http://localhost:3000/docs (FastAPI/Swagger).

**2. Frontend** — http://localhost:4200
```bash
cd frontend
npm install
npm start
```
Open http://localhost:4200.

## KPIs implemented (from docs/DATA_REQUEST.md)

Due · Renewed · Pending · Renewal % · Expected Premium (gross + net) ·
Collected Premium · Payment-link available · Notice available
(`pdf_trn_id` + `control_no`) · Online vs Offline (Probus vs insurer) ·
RM-assisted vs Customer-direct (`am_id`) · reminder buckets by days-to-expiry.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | record count + source file |
| `GET /api/filters` | dropdown options + expiry date bounds |
| `GET /api/dashboard?from&to&company&rm&posp&platform&segment&channel&isRenewed&trendBy&today` | KPIs, trend, buckets, splits, rankings |
| `GET /api/policies?<filters>&page&pageSize&sortBy&sortDir` | paginated detail rows |
| `POST /api/reload` | re-read the Excel without restart |

Swap the Excel for Binal Ma'am's stored-procedure output later by replacing the
loader in `backend/adapter.py` (return the same record dicts) — the rest of the
app is unchanged.
