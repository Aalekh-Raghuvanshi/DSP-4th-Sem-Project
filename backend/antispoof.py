"""
antispoof.py — Multi-signal passive anti-spoof
================================================
Signals (all computed on a tight face crop):

  1. LBP variance      — real skin has rich micro-texture patterns
  2. Gradient mean     — real faces have sharp micro-edges (pores, hair)
  3. HSV sat std-dev   — real skin has naturally varied colour saturation
  4. Laplacian var     — focus/sharpness proxy; flat prints are sharper than live faces at distance
  5. Chroma noise      — high-freq noise in Cb channel; sensor noise on real faces

Thresholds are set via the tester tool (antispoof_tester.html).
Run the tester, note live vs spoof readings, then set each threshold
midway between them below.
"""

import cv2, logging, numpy as np
from pathlib import Path

log       = logging.getLogger(__name__)
MODEL_DIR = Path("antispoof_model")
_loaded   = False

# ── Thresholds ────────────────────────────────────────────────────────────────
# Set each value midway between your live and spoof readings from the tester.
# Defaults are conservative — update after running antispoof_tester.html
THRESHOLDS = {
    "lbp_var":      5e-5,   # LBP histogram variance
    "grad_mean":    3.5,    # mean Sobel gradient magnitude
    "hsv_sat_std":  8.0,    # std-dev of HSV saturation channel
    "chroma_noise": 0.8,    # high-freq noise in Cb channel
}

# Number of signals (out of 4) that must pass
MIN_PASSING = 2


def load_models() -> bool:
    global _loaded
    _loaded = True
    log.info("✅  Multi-signal anti-spoof ready")
    return True


# ── Signal functions ──────────────────────────────────────────────────────────

def _lbp_variance(gray: np.ndarray) -> float:
    center = gray[1:-1, 1:-1].astype(np.int16)
    dirs   = [gray[0:-2,0:-2], gray[0:-2,1:-1], gray[0:-2,2:],
              gray[1:-1,2:],   gray[2:,2:],     gray[2:,1:-1],
              gray[2:,0:-2],   gray[1:-1,0:-2]]
    code = np.zeros_like(center, dtype=np.uint8)
    for i, nb in enumerate(dirs):
        code |= ((nb.astype(np.int16) >= center).astype(np.uint8) << i)
    hist, _ = np.histogram(code, bins=256, range=(0, 256))
    hist = hist.astype(np.float64) / (hist.sum() + 1e-10)
    return float(np.var(hist))


def _gradient_mean(gray: np.ndarray) -> float:
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    return float(np.mean(np.sqrt(gx**2 + gy**2)))


def _hsv_sat_std(img_bgr: np.ndarray) -> float:
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    return float(np.std(hsv[:, :, 1]))


def _chroma_noise(img_bgr: np.ndarray) -> float:
    ycrcb   = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2YCrCb).astype(np.float32)
    cb      = ycrcb[:, :, 2]
    blurred = cv2.GaussianBlur(cb, (5, 5), 0)
    return float(np.mean(np.abs(cb - blurred)))


def _crop_face(img_bgr: np.ndarray, bbox, scale: float = 1.5, size: int = 64):
    x1,y1,x2,y2 = int(bbox[0]),int(bbox[1]),int(bbox[2]),int(bbox[3])
    w,h   = x2-x1, y2-y1
    cx,cy = x1+w//2, y1+h//2
    half  = int(max(w,h) * scale / 2)
    H,W   = img_bgr.shape[:2]
    sx1,sy1 = max(0,cx-half), max(0,cy-half)
    sx2,sy2 = min(W,cx+half), min(H,cy+half)
    crop = img_bgr[sy1:sy2, sx1:sx2]
    return cv2.resize(crop if crop.size else img_bgr, (size, size))


# ── Public API ────────────────────────────────────────────────────────────────

def analyze(img_bgr: np.ndarray, bbox) -> dict:
    """Return raw signal values. Used by both check_liveness() and /analyze-frame."""
    crop = _crop_face(img_bgr, bbox, scale=1.5, size=64)
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    return {
        "lbp_var":      round(_lbp_variance(gray), 7),
        "grad_mean":    round(_gradient_mean(gray), 4),
        "hsv_sat_std":  round(_hsv_sat_std(crop), 4),
        "chroma_noise": round(_chroma_noise(crop), 4),
    }


def check_liveness(img_bgr: np.ndarray, bbox) -> dict:
    if not _loaded:
        return {"is_live": True, "real_prob": 1.0, "verdict": "DISABLED", "enabled": False}

    signals = analyze(img_bgr, bbox)
    passing = 0
    details = {}

    for key, threshold in THRESHOLDS.items():
        val    = signals[key]
        passes = val > threshold
        if passes:
            passing += 1
        details[key] = {"value": val, "threshold": threshold, "pass": passes}

    is_live   = passing >= MIN_PASSING
    real_prob = passing / len(THRESHOLDS)

    log.info(f"  AntiSpoof: {passing}/{len(THRESHOLDS)} → {'LIVE' if is_live else 'SPOOF'}")

    return {
        "is_live":   is_live,
        "real_prob": round(real_prob, 3),
        "verdict":   "LIVE" if is_live else "SPOOF",
        "enabled":   True,
        "signals":   details,
    }