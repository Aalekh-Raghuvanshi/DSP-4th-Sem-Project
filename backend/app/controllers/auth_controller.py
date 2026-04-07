import logging
from fastapi import HTTPException, UploadFile
from fastapi.responses import JSONResponse

import app.state as state
from app.config import SIMILARITY_THRESHOLD, MARGIN_REQUIRED, MIN_BLINKS_REQUIRED
from app.utils.audit import write_audit
from app.utils.face import decode_image, get_face, per_person_scores
from app.utils.session import make_session

log = logging.getLogger(__name__)


async def health():
    return {
        "status":      "ok",
        "model_ready": state.known_embeddings is not None,
        "users":       list(dict.fromkeys(state.known_names)) if state.known_names else [],
        "threshold":   SIMILARITY_THRESHOLD,
        "margin":      MARGIN_REQUIRED,
        "min_blinks":  MIN_BLINKS_REQUIRED,
    }


async def authenticate(file: UploadFile, liveness_passed: bool = False, blink_count: int = 0):
    if state.known_embeddings is None or not state.known_names:
        raise HTTPException(503, "Face model not loaded — run train_model.py first.")

    if not liveness_passed or blink_count < MIN_BLINKS_REQUIRED:
        detail = f"Blink liveness check failed (need {MIN_BLINKS_REQUIRED} blink{'s' if MIN_BLINKS_REQUIRED != 1 else ''})."
        write_audit("DENIED_LIVENESS", reason=detail)
        return JSONResponse(
            status_code=401,
            content={
                "success": False,
                "authenticated": False,
                "reason": "DENIED_LIVENESS",
                "message": detail,
                "blink_count": blink_count,
            },
        )

    raw = await file.read()
    try:
        img = decode_image(raw)
    except Exception:
        raise HTTPException(400, "Cannot decode image.")

    # ── Detect face ───────────────────────────────────────────────────────────
    face, _ = get_face(img)
    if face is None:
        write_audit("NO_FACE", reason="No face detected in frame")
        raise HTTPException(
            422,
            "No face detected. Ensure good lighting and look directly at the camera.",
        )

    log.info("━━━ Auth attempt ━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    log.info(f"  det_score : {face.det_score:.3f}")

    # ── Face recognition ─────────────────────────────────────────────────────
    scores       = per_person_scores(face.normed_embedding)
    ranked       = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    best_name, best_score = ranked[0]
    second_score = ranked[1][1] if len(ranked) > 1 else -1.0
    margin       = round(best_score - max(second_score, 0.0), 4)

    log.info(f"  Scores    : {scores}")
    log.info(f"  Best      : '{best_name}'  {best_score:.4f}")
    log.info(f"  Margin    : {margin:.4f}")

    passes_threshold = best_score >= SIMILARITY_THRESHOLD
    passes_margin    = len(ranked) <= 1 or margin >= MARGIN_REQUIRED

    if passes_threshold and passes_margin:
        token = make_session(best_name)
        write_audit(
            "GRANTED",
            username=best_name,
            similarity=best_score,
            det=float(face.det_score),
        )
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
            "blink_count":      blink_count,
        }

    # ── Denial ────────────────────────────────────────────────────────────────
    if not passes_threshold:
        outcome = "DENIED_MISMATCH"
        detail  = f"Score {best_score*100:.1f}% below threshold {SIMILARITY_THRESHOLD*100:.0f}%"
    else:
        outcome = "DENIED_AMBIGUOUS"
        detail  = f"Margin {margin*100:.1f}% too small (need ≥{MARGIN_REQUIRED*100:.0f}%)"

    write_audit(
        outcome,
        username=best_name,
        similarity=best_score,
        det=float(face.det_score),
        reason=detail,
    )
    log.warning(f"  ❌  DENIED — {detail}")
    log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    return JSONResponse(
        status_code=401,
        content={
            "success":          False,
            "authenticated":    False,
            "reason":           outcome,
            "similarity_score": round(best_score, 4),
            "margin":           margin,
            "all_scores":       scores,
            "det_score":        round(float(face.det_score), 3),
            "message":          detail,
            "blink_count":      blink_count,
        },
    )
