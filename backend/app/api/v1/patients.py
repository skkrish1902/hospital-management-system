"""
Patients API — UHID registration, search, profile management.

UHID format: YYYYMMDD-NNNN  (date of registration + daily sequence)
"""
import uuid
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, require_role
from app.db.engine import get_session
from app.models.tenant.patient import Patient
from app.schemas.patient import PatientCreate, PatientRead, PatientUpdate

router = APIRouter()

ALLOWED_ROLES = ("receptionist", "hospital_admin", "super_admin", "doctor", "nurse")


async def _generate_uhid(session: AsyncSession) -> str:
    today = date.today().strftime("%Y%m%d")
    prefix = f"UHID-{today}-"
    # Count patients registered today
    result = await session.execute(
        select(func.count()).select_from(Patient).where(Patient.uhid.like(f"{prefix}%"))
    )
    count = result.scalar() or 0
    return f"{prefix}{count + 1:04d}"


@router.post("", response_model=PatientRead, status_code=status.HTTP_201_CREATED)
async def register_patient(
    payload: PatientCreate,
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_role(*ALLOWED_ROLES)),
):
    uhid = await _generate_uhid(session)
    patient = Patient(id=uuid.uuid4(), uhid=uhid, **payload.model_dump())
    session.add(patient)
    await session.commit()
    await session.refresh(patient)
    return patient


@router.get("", response_model=List[PatientRead])
async def list_patients(
    q: Optional[str] = Query(None, description="Search by name, phone, or UHID"),
    skip: int = 0,
    limit: int = Query(20, le=100),
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_role(*ALLOWED_ROLES)),
):
    stmt = select(Patient).where(Patient.is_active == True)  # noqa: E712
    if q:
        term = f"%{q}%"
        stmt = stmt.where(
            or_(
                Patient.uhid.ilike(term),
                Patient.phone.ilike(term),
                func.concat(Patient.first_name, " ", Patient.last_name).ilike(term),
                Patient.first_name.ilike(term),
                Patient.last_name.ilike(term),
            )
        )
    stmt = stmt.order_by(Patient.created_at.desc()).offset(skip).limit(limit)
    result = await session.execute(stmt)
    return result.scalars().all()


@router.get("/{patient_id}", response_model=PatientRead)
async def get_patient(
    patient_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_role(*ALLOWED_ROLES)),
):
    patient = await session.get(Patient, patient_id)
    if not patient or not patient.is_active:
        raise HTTPException(status_code=404, detail="Patient not found")
    return patient


@router.patch("/{patient_id}", response_model=PatientRead)
async def update_patient(
    patient_id: uuid.UUID,
    payload: PatientUpdate,
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_role(*ALLOWED_ROLES)),
):
    patient = await session.get(Patient, patient_id)
    if not patient or not patient.is_active:
        raise HTTPException(status_code=404, detail="Patient not found")
    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(patient, field, value)
    await session.commit()
    await session.refresh(patient)
    return patient
