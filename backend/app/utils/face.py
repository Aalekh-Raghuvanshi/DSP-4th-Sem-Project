import logging
import pickle
import numpy as np
import cv2
from typing import Dict, Tuple, Optional
from insightface.app import FaceAnalysis

import app.state as state
from app.config import MODEL_PATH

log = logging.getLogger(__name__)

log.info("Loading InsightFace buffalo_l ...")
_face_app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
_face_app.prepare(ctx_id=0, det_size=(640, 640))
log.info("✅  InsightFace ready")


def load_face_model():
    if not MODEL_PATH.exists():
        log.warning(f"Face model not found: {MODEL_PATH} — run train_model.py first")
        state.known_embeddings = None
        state.known_names = []
        return
    with open(MODEL_PATH, "rb") as f:
        data = pickle.load(f)
    state.known_embeddings = data["embeddings"]
    state.known_names = data["names"]
    unique = list(dict.fromkeys(state.known_names))
    log.info(
        f"✅  Face model loaded — {len(state.known_names)} samples, "
        f"{len(unique)} people: {unique}"
    )


def decode_image(data: bytes) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Cannot decode image")
    return img


def get_face(img_bgr: np.ndarray) -> Tuple[Optional[object], Optional[np.ndarray]]:
    for candidate in [img_bgr, cv2.flip(img_bgr, 1)]:
        faces = _face_app.get(candidate)
        if faces:
            return faces[0], candidate
    return None, None


def per_person_scores(probe: np.ndarray) -> Dict[str, float]:
    sims = np.dot(state.known_embeddings, probe)
    result = {}
    for person in list(dict.fromkeys(state.known_names)):
        idx = [i for i, n in enumerate(state.known_names) if n == person]
        result[person] = round(float(np.max(sims[idx])), 4)
    return result