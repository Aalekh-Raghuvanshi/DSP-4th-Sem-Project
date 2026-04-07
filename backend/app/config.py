from pathlib import Path

MODEL_PATH           = Path("trained_model/face_embeddings_insightface.pkl")
AUDIT_LOG_PATH       = Path("audit_log.csv")
SIMILARITY_THRESHOLD = 0.65
MARGIN_REQUIRED      = 0.10
MIN_BLINKS_REQUIRED  = 1
SESSION_TTL_MINUTES  = 30
