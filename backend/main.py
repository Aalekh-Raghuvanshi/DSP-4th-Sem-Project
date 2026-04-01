import logging
from fastapi import FastAPI

from app.middleware.cors import register_cors
from app.routes.auth_routes import router as auth_router
from app.routes.audit_routes import router as audit_router
from app.utils.audit import init_audit_log
from app.utils.face import load_face_model

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")

app = FastAPI(title="NeuralGate", version="5.0.0")

register_cors(app)

app.include_router(auth_router)
app.include_router(audit_router)


@app.on_event("startup")
async def startup():
    init_audit_log()
    load_face_model()