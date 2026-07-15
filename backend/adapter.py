"""SQL Server -> normalized renewal records (one clean dict per policy).

Pulls the 36-column renewal dataset from `saiba_renewal_transaction_data` and
normalizes each row into the same record dict the rest of the app expects, so
aggregations / the API / the frontend are unchanged.
"""
from __future__ import annotations

import math
import os
from datetime import date, datetime, timedelta
from typing import Any

from db import get_connection

# Official product master (Binal Madam's mapping sheet). product_id -> name.
PRODUCT_MAP = {
    "1": "Health", "2": "Motor", "3": "Travel", "4": "SME",
    "5": "Life", "6": "Miscellaneous", "7": "Rural Agri",
}

# Official sub-product master. sub_product_id -> name. (Names can repeat across
# products, e.g. Individual/Family — so filtering is done by ID, not name.)
SUB_PRODUCT_MAP = {
    "1": "Two Wheeler", "2": "Private Car", "3": "Individual", "4": "Family",
    "5": "Individual", "6": "Family", "7": "MultiTrip", "8": "Student",
    "9": "Passenger Vehicle", "10": "Goods Vehicle", "11": "Employees Compensation",
    "12": "Fire and Burglary", "13": "Marine Insurance", "14": "Home Insurance",
    "15": "Term", "16": "SME - Other", "17": "Miscellaneous Vehicle", "18": "GMC",
    "19": "GPA", "20": "Endowment", "21": "Ulip", "22": "Life - Other",
    "23": "Multi Individual", "24": "MOSBITE", "25": "PET", "26": "Personal Accident",
    "27": "Hospital Cash", "28": "Business Insurance", "29": "Saving/Investment",
    "30": "D&O Policy", "31": "Public Liability", "32": "Product Liability", "33": "E & O",
    "34": "Professional/Doctor's Indemnity", "35": "Cyber Liability", "36": "Crime Policy",
    "37": "Kidnap & Ransom Insurance", "38": "Group Travel Insurance", "39": "Pension",
    "40": "Annuity", "41": "T-ULIP", "42": "Standalone CPA", "43": "Crop Insurance",
    "44": "Surety Bond",
}

# Backwards-compat alias (the old "segment" derived field = sub-product name).
SEGMENT_MAP = SUB_PRODUCT_MAP

# The OFFICIAL Health sub-products (the dashboard is Health-only). Only these four
# get a display name; any other sub_product_id present in the live data (0, 5, 6,
# 18, 19, …) is shown as its raw id.
HEALTH_SUB_PRODUCT_MAP = {
    "3": "Individual", "4": "Family", "23": "Multi Individual", "26": "Personal Accident",
}


def sub_product_name(sid) -> str:
    """Display name for a sub_product_id: official Health name, else the id itself."""
    sid = str(sid)
    return HEALTH_SUB_PRODUCT_MAP.get(sid, sid)

# The 36 columns of the renewal data contract (docs/DATA_REQUEST.md), in order.
COLUMNS = [
    "id", "pdf_trn_id", "control_no", "company_name", "policy_type", "policy_no",
    "issue_date", "policy_start_date", "policy_exp_date", "platform", "insured_name",
    "cust_email", "cust_mobile", "vehicle_regi_no", "user_id", "pos_name", "pos_email",
    "pos_mobile", "am_id", "rm_name", "rm_email", "rm_mobile", "company_id", "entry_on",
    "payment_link", "updated_on", "is_renewed", "vertical_name", "sum_insured",
    "net_premium", "gross_premium", "make", "chasis_no", "engine_no", "product_id",
    "sub_product_id",
]

TABLE = "saiba_renewal_transaction_data"

# Renewal work starts ~45 days before expiry, so the working set is policies
# expiring within the next N days from today (override with RENEWAL_WINDOW_DAYS).
WINDOW_DAYS = int(os.environ.get("RENEWAL_WINDOW_DAYS") or 45)

_NULLISH = {"", "null", "na", "n/a", "nan", "none", "nat"}


def _is_null(v: Any) -> bool:
    if v is None:
        return True
    if isinstance(v, float) and math.isnan(v):
        return True
    return str(v).strip().lower() in _NULLISH


def s(v: Any) -> str | None:
    """Clean string, or None. Integer-valued floats render without the .0 tail."""
    if _is_null(v):
        return None
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def truthy(v: Any) -> bool:
    """Renewal flag. SQL Server BIT comes back as a Python bool via pymssql,
    but also accept 1 / '1' / 'true' / 'y' from other sources."""
    if isinstance(v, bool):
        return v
    if _is_null(v):
        return False
    return str(v).strip().lower() in {"1", "true", "y", "yes"}


def n(v: Any) -> int:
    if _is_null(v):
        return 0
    try:
        return int(round(float(str(v).replace(",", ""))))
    except (ValueError, TypeError):
        return 0


def date_iso(v: Any) -> str | None:
    """ISO yyyy-mm-dd. SQL Server returns datetime/date objects via pymssql."""
    if _is_null(v):
        return None
    if isinstance(v, (datetime, date)):
        return v.strftime("%Y-%m-%d")
    try:
        return datetime.fromisoformat(str(v)[:19]).strftime("%Y-%m-%d")
    except Exception:
        return None


def mask_mobile(v: str | None) -> str | None:
    """PII: customer phone numbers leave the API masked — only the last 4 digits
    survive (8102202020 -> xxxxxx2020). Applies to the policy list AND the CSV
    export (both are built from record_from_row)."""
    if not v:
        return v
    v = str(v).strip()
    if len(v) <= 4:
        return "x" * len(v)
    return "x" * (len(v) - 4) + v[-4:]


def record_from_row(r: dict) -> dict:
    """Map one raw DB row (keyed by the 36 column names) to a normalized record."""
    am_id = s(r.get("am_id")) or "0"
    pdf_trn_id = n(r.get("pdf_trn_id"))
    control_no = s(r.get("control_no"))
    payment_link = s(r.get("payment_link"))
    sub_product_id = s(r.get("sub_product_id")) or ""
    product_id = s(r.get("product_id")) or ""

    return {
        "id": s(r.get("id")) or "",
        "pdfTrnId": pdf_trn_id,
        "controlNo": control_no or "",
        "companyName": s(r.get("company_name")) or "Unknown",
        "companyId": s(r.get("company_id")) or "",
        "policyType": s(r.get("policy_type")) or "",
        "policyNo": s(r.get("policy_no")) or "",
        "issueDate": date_iso(r.get("issue_date")),
        "policyStartDate": date_iso(r.get("policy_start_date")),
        "policyExpDate": date_iso(r.get("policy_exp_date")),
        "platform": (s(r.get("platform")) or "UNKNOWN").upper(),
        "insuredName": s(r.get("insured_name")) or "",
        "custEmail": s(r.get("cust_email")),
        "custMobile": mask_mobile(s(r.get("cust_mobile"))),
        "vehicleRegiNo": s(r.get("vehicle_regi_no")),
        "userId": s(r.get("user_id")) or "0",
        "posName": s(r.get("pos_name")),
        "posEmail": s(r.get("pos_email")),
        "posMobile": s(r.get("pos_mobile")),
        "amId": am_id,
        "rmName": s(r.get("rm_name")),
        "rmEmail": s(r.get("rm_email")),
        "rmMobile": s(r.get("rm_mobile")),
        "entryOn": date_iso(r.get("entry_on")),
        "paymentLink": payment_link,
        "updatedOn": date_iso(r.get("updated_on")),
        "isRenewed": truthy(r.get("is_renewed")),
        "verticalName": (s(r.get("vertical_name")) or "UNKNOWN").upper(),
        "sumInsured": n(r.get("sum_insured")),
        "netPremium": n(r.get("net_premium")),
        "grossPremium": n(r.get("gross_premium")),
        "make": s(r.get("make")),
        "chasisNo": s(r.get("chasis_no")),
        "engineNo": s(r.get("engine_no")),
        "productId": product_id,
        "productName": PRODUCT_MAP.get(product_id, f"Other ({product_id})" if product_id else "Unknown"),
        "subProductId": sub_product_id,

        # derived
        "segment": sub_product_name(sub_product_id) if sub_product_id else "Unknown",
        "channel": "RM" if am_id != "0" else "CUSTOMER",
        # '0'/empty control_no = no control number (matches queries.NOTICE in SQL)
        "noticeAvailable": pdf_trn_id > 0 and bool(control_no) and control_no != "0",
        "hasPaymentLink": bool(payment_link),
    }
