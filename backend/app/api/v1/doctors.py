"""
Doctors API — list available doctors for dropdowns (consultation, visit creation).
"""
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_role
from app.db.engine import get_session
from app.models.tenant.doctor import Doctor
from app.schemas.doctor import DoctorRead

router = APIRouter()


@router.get("", response_model=List[DoctorRead])
async def list_doctors(
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_role(
        "receptionist", "nurse", "doctor", "hospital_admin", "super_admin"
    )),
):
    result = await session.execute(
        select(Doctor).where(Doctor.is_active == True).order_by(Doctor.full_name)  # noqa: E712
    )
    return result.scalars().all()
