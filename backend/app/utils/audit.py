import csv
import logging
from datetime import datetime
from app.config import AUDIT_LOG_PATH

log = logging.getLogger(__name__)

AUDIT_FIELDS = [
    "timestamp", "outcome", "username_matched",
    "similarity_score", "det_score",
    "reason", "ip",
]


def init_audit_log():
    if not AUDIT_LOG_PATH.exists():
        with open(AUDIT_LOG_PATH, "w", newline="") as f:
            csv.DictWriter(f, fieldnames=AUDIT_FIELDS).writeheader()


def write_audit(
    outcome: str,
    username: str = "",
    similarity: float = 0.0,
    det: float = 0.0,
    reason: str = "",
    ip: str = "",
):
    init_audit_log()
    row = {
        "timestamp":        datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
        "outcome":          outcome,
        "username_matched": username,
        "similarity_score": round(similarity, 4),
        "det_score":        round(det, 4),
        "reason":           reason,
        "ip":               ip,
    }
    with open(AUDIT_LOG_PATH, "a", newline="") as f:
        csv.DictWriter(f, fieldnames=AUDIT_FIELDS).writerow(row)
    log.info(f"  📋  Audit: {outcome}  user={username or '-'}")