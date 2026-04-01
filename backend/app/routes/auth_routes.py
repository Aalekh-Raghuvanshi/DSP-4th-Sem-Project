from fastapi import APIRouter, UploadFile, File
from app.controllers import auth_controller

router = APIRouter()


@router.get("/health")
async def health():
    return await auth_controller.health()


@router.post("/authenticate")
async def authenticate(file: UploadFile = File(...)):
    return await auth_controller.authenticate(file)