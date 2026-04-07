from fastapi import APIRouter, UploadFile, File, Form
from app.controllers import auth_controller

router = APIRouter()


@router.get("/health")
async def health():
    return await auth_controller.health()


@router.post("/authenticate")
async def authenticate(
    file: UploadFile = File(...),
    liveness_passed: bool = Form(False),
    blink_count: int = Form(0),
):
    return await auth_controller.authenticate(file, liveness_passed, blink_count)
