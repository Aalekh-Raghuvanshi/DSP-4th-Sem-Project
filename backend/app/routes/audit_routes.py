from fastapi import APIRouter
from app.controllers import audit_controller

router = APIRouter()


@router.get("/audit-log")
async def get_audit_log(limit: int = 100):
    return await audit_controller.get_audit_log(limit)