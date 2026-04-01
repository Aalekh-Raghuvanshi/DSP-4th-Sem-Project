import uuid
from datetime import datetime, timedelta
import app.state as state
from app.config import SESSION_TTL_MINUTES


def make_session(username: str) -> str:
    token = str(uuid.uuid4())
    state.session_store[token] = {
        "username":   username,
        "created_at": datetime.utcnow().isoformat(),
        "expires_at": (
            datetime.utcnow() + timedelta(minutes=SESSION_TTL_MINUTES)
        ).isoformat(),
    }
    return token