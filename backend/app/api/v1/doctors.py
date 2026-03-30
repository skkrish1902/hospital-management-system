"""
Doctors API — list (public) + admin CRUD.
"""
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_role
from app.db.engine import get_session
from app.models.tenant.department import Department
from app.models.tenant.doctor import Doctor
from app.schemas.doctor import DoctorCreate, DoctorRead, DoctorUpdate

router = APIRouter()


async def _enrich(doctor: Doctor, session: AsyncSession) -> DoctorRead:
    """Attach department_name to a DoctorRead."""
    read = DoctorRead.model_validate(doctor)
    if doctor.department_id:
        dept = await session.get(Department, doctor.department_id)
        read.department_name = dept.name if dept else None
    return read


@router.get("", response_model=List[DoctorRead])
async def list_doctors(
    include_inactive: bool = False,
    department_id: Optional[uuid.UUID] = None,
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_role(
        "receptionist", "nurse", "doctor", "billing_officer",
        "hospital_admin", "super_admin",
    )),
):
    stmt = select(Doctor).order_by(Doctor.full_name)
    if not include_inactive:
        stmt = stmt.where(Doctor.is_active == True)  # noqa: E712
    if department_id:
        stmt = stmt.where(Doctor.department_id == department_id)
    doctors = (await session.execute(stmt)).scalars().all()
    return [await _enrich(d, session) for d in doctors]


@router.post("", response_model=DoctorRead, status_code=status.HTTP_201_CREATED)
async def create_doctor(
    payload: DoctorCreate,
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_role("hospital_admin", "super_admin")),
):
    doctor = Doctor(id=uuid.uuid4(), **payload.model_dump())
    session.add(doctor)
    await session.commit()
    await session.refresh(doctor)
    return await _enrich(doctor, session)


@router.get("/{doctor_id}", response_model=DoctorRead)
async def get_doctor(
    doctor_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_role(
        "receptionist", "nurse", "doctor", "hospital_admin", "super_admin",
    )),
):
    doctor = await session.get(Doctor, doctor_id)
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")
    return await _enrich(doctor, session)


@router.patch("/{doctor_id}", response_model=DoctorRead)
async def update_doctor(
    doctor_id: uuid.UUID,
    payload: DoctorUpdate,
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_role("hospital_admin", "super_admin")),
):
    doctor = await session.get(Doctor, doctor_id)
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(doctor, field, value)
    await session.commit()
    await session.refresh(doctor)
    return await _enrich(doctor, session)
