"""
NeuralGate — FastAPI server with ArcFace recognition + passive liveness + audit log
─────────────────────────────────────────────────────────────────────────────────────
Setup:
    python train_model.py
    uvicorn main:app --reload --port 8000
"""

import csv
import uuid
import pickle
import logging
import numpy as np
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, List, Dict

import cv2
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from insightface.app import FaceAnalysis

import antispoof

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

# ─── Config ───────────────────────────────────────────────────────────────────
MODEL_PATH           = Path("trained_model/face_embeddings_insightface.pkl")
AUDIT_LOG_PATH       = Path("audit_log.csv")
SIMILARITY_THRESHOLD = 0.70
MARGIN_REQUIRED      = 0.10
SESSION_TTL_MINUTES  = 30

# ─── InsightFace ──────────────────────────────────────────────────────────────
log.info("Loading InsightFace buffalo_l ...")
app_face = FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider'])
app_face.prepare(ctx_id=0, det_size=(640, 640))
log.info("✅  InsightFace ready")

# ─── Anti-spoof ───────────────────────────────────────────────────────────────
ANTISPOOF_ENABLED = antispoof.load_models()

# ─── State ────────────────────────────────────────────────────────────────────
known_embeddings: Optional[np.ndarray] = None
known_names: List[str] = []
session_store: Dict[str, dict] = {}


# ─── Audit log ────────────────────────────────────────────────────────────────

AUDIT_FIELDS = [
    "timestamp", "outcome", "username_matched",
    "similarity_score", "liveness_score", "det_score",
    "reason", "ip"
]

def _init_audit_log():
    if not AUDIT_LOG_PATH.exists():
        with open(AUDIT_LOG_PATH, "w", newline="") as f:
            csv.DictWriter(f, fieldnames=AUDIT_FIELDS).writeheader()

def write_audit(outcome: str, username: str = "", similarity: float = 0.0,
                liveness: float = 0.0, det: float = 0.0,
                reason: str = "", ip: str = ""):
    _init_audit_log()
    row = {
        "timestamp":        datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
        "outcome":          outcome,           # GRANTED | DENIED_SPOOF | DENIED_MISMATCH | DENIED_AMBIGUOUS | NO_FACE
        "username_matched": username,
        "similarity_score": round(similarity, 4),
        "liveness_score":   round(liveness, 4),
        "det_score":        round(det, 4),
        "reason":           reason,
        "ip":               ip,
    }
    with open(AUDIT_LOG_PATH, "a", newline="") as f:
        csv.DictWriter(f, fieldnames=AUDIT_FIELDS).writerow(row)
    log.info(f"  📋  Audit: {outcome}  user={username or '-'}")


# ─── Helpers ──────────────────────────────────────────────────────────────────

def load_face_model():
    global known_embeddings, known_names
    if not MODEL_PATH.exists():
        log.warning(f"Face model not found: {MODEL_PATH} — run train_model.py first")
        known_embeddings = None
        known_names = []
        return
    with open(MODEL_PATH, 'rb') as f:
        data = pickle.load(f)
    known_embeddings = data['embeddings']
    known_names      = data['names']
    unique = list(dict.fromkeys(known_names))
    log.info(f"✅  Face model loaded — {len(known_names)} samples, {len(unique)} people: {unique}")


def decode_image(data: bytes) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Cannot decode image")
    return img


def get_face(img_bgr: np.ndarray):
    for candidate in [img_bgr, cv2.flip(img_bgr, 1)]:
        faces = app_face.get(candidate)
        if faces:
            return faces[0], candidate
    return None, None


def per_person_scores(probe: np.ndarray) -> Dict[str, float]:
    sims = np.dot(known_embeddings, probe)
    result = {}
    for person in list(dict.fromkeys(known_names)):
        idx = [i for i, n in enumerate(known_names) if n == person]
        result[person] = round(float(np.max(sims[idx])), 4)
    return result


def make_session(username: str) -> str:
    token = str(uuid.uuid4())
    session_store[token] = {
        "username":   username,
        "created_at": datetime.utcnow().isoformat(),
        "expires_at": (datetime.utcnow() + timedelta(minutes=SESSION_TTL_MINUTES)).isoformat(),
    }
    return token


# ─── FastAPI ──────────────────────────────────────────────────────────────────
server = FastAPI(title="NeuralGate", version="5.0.0")
server.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)


@server.on_event("startup")
async def startup():
    _init_audit_log()
    load_face_model()


@server.get("/health")
async def health():
    return {
        "status":      "ok",
        "model_ready": known_embeddings is not None,
        "antispoof":   ANTISPOOF_ENABLED,
        "users":       list(dict.fromkeys(known_names)) if known_names else [],
        "threshold":   SIMILARITY_THRESHOLD,
        "margin":      MARGIN_REQUIRED,
    }


@server.post("/authenticate")
async def authenticate(file: UploadFile = File(...)):
    if known_embeddings is None or not known_names:
        raise HTTPException(503, "Face model not loaded — run train_model.py first.")

    raw = await file.read()
    try:
        img = decode_image(raw)
    except Exception:
        raise HTTPException(400, "Cannot decode image.")

    # ── Detect face ───────────────────────────────────────────────────────────
    face, img_used = get_face(img)
    if face is None:
        write_audit("NO_FACE", reason="No face detected in frame")
        raise HTTPException(422, "No face detected. Ensure good lighting and look directly at the camera.")

    log.info("━━━ Auth attempt ━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    log.info(f"  det_score : {face.det_score:.3f}")

    # ── Gate 1: Liveness ─────────────────────────────────────────────────────
    spoof = antispoof.check_liveness(img_used, face.bbox)

    if spoof["enabled"] and not spoof["is_live"]:
        write_audit("DENIED_SPOOF",
                    liveness=spoof["real_prob"],
                    det=float(face.det_score),
                    reason=f"Liveness failed (real_prob={spoof['real_prob']})")
        log.warning(f"  ❌  DENIED — SPOOF")
        log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        return JSONResponse(status_code=403, content={
            "success": False, "authenticated": False,
            "reason":  "SPOOF_DETECTED",
            "message": f"Spoof detected (real_prob={spoof['real_prob']:.2f})",
            "spoof":   spoof,
        })

    # ── Gate 2 & 3: Face recognition ─────────────────────────────────────────
    scores  = per_person_scores(face.normed_embedding)
    ranked  = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    best_name,  best_score  = ranked[0]
    second_score = ranked[1][1] if len(ranked) > 1 else -1.0
    margin = round(best_score - max(second_score, 0.0), 4)

    log.info(f"  Scores    : {scores}")
    log.info(f"  Best      : '{best_name}'  {best_score:.4f}")
    log.info(f"  Margin    : {margin:.4f}")

    passes_threshold = best_score >= SIMILARITY_THRESHOLD
    passes_margin    = len(ranked) <= 1 or margin >= MARGIN_REQUIRED

    if passes_threshold and passes_margin:
        token = make_session(best_name)
        write_audit("GRANTED",
                    username=best_name,
                    similarity=best_score,
                    liveness=spoof["real_prob"],
                    det=float(face.det_score))
        log.info(f"  ✅  GRANTED — '{best_name}'")
        log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        return {
            "success":          True,
            "authenticated":    True,
            "username":         best_name,
            "session_token":    token,
            "similarity_score": round(best_score, 4),
            "margin":           margin,
            "all_scores":       scores,
            "det_score":        round(float(face.det_score), 3),
            "spoof":            spoof,
        }

    if not passes_threshold:
        outcome = "DENIED_MISMATCH"
        detail  = f"Score {best_score*100:.1f}% below threshold {SIMILARITY_THRESHOLD*100:.0f}%"
    else:
        outcome = "DENIED_AMBIGUOUS"
        detail  = f"Margin {margin*100:.1f}% too small (need ≥{MARGIN_REQUIRED*100:.0f}%)"

    write_audit(outcome,
                username=best_name,
                similarity=best_score,
                liveness=spoof["real_prob"],
                det=float(face.det_score),
                reason=detail)
    log.warning(f"  ❌  DENIED — {detail}")
    log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    return JSONResponse(status_code=401, content={
        "success":          False,
        "authenticated":    False,
        "reason":           outcome,
        "similarity_score": round(best_score, 4),
        "margin":           margin,
        "all_scores":       scores,
        "det_score":        round(float(face.det_score), 3),
        "spoof":            spoof,
        "message":          detail,
    })


@server.get("/audit-log")
async def get_audit_log(limit: int = 100):
    """Return the last `limit` audit log entries, newest first."""
    if not AUDIT_LOG_PATH.exists():
        return {"entries": [], "total": 0}

    with open(AUDIT_LOG_PATH, "r", newline="") as f:
        rows = list(csv.DictReader(f))

    rows.reverse()   # newest first
    total = len(rows)
    rows  = rows[:limit]

    # Cast numeric fields
    for r in rows:
        for field in ("similarity_score", "liveness_score", "det_score"):
            try:
                r[field] = float(r[field])
            except (ValueError, KeyError):
                r[field] = 0.0

    return {"entries": rows, "total": total}


@server.post("/reload")
async def reload():
    load_face_model()
    return {"success": True, "users": list(dict.fromkeys(known_names)) if known_names else []}


@server.get("/users")
async def users():
    return {"users": list(dict.fromkeys(known_names)) if known_names else []}


app = server