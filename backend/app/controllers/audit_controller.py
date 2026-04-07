import csv
from app.config import AUDIT_LOG_PATH
from app.utils.audit import write_audit


async def get_audit_log(limit: int = 100):
    """Return the last `limit` audit log entries, newest first."""
    if not AUDIT_LOG_PATH.exists():
        return {"entries": [], "total": 0}

    with open(AUDIT_LOG_PATH, "r", newline="") as f:
        rows = list(csv.DictReader(f))

    rows.reverse()
    total = len(rows)
    rows  = rows[:limit]

    for r in rows:
        for field in ("similarity_score", "det_score"):
            try:
                r[field] = float(r[field])
            except (ValueError, KeyError):
                r[field] = 0.0

    return {"entries": rows, "total": total}


async def log_blink_timeout():
    reason = "No blink detected within 6 seconds; returned to homepage"
    write_audit("DENIED_TIMEOUT", reason=reason)
    return {"success": True, "logged": True, "outcome": "DENIED_TIMEOUT", "reason": reason}
