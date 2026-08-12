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
from app.core.sms import send_patient_welcome
from app.db.engine import get_session, tenant_schema_var
from app.models.public.user import Tenant
from app.models.tenant.consultation import Consultation
from app.models.tenant.department import Department
from app.models.tenant.doctor import Doctor
from app.models.tenant.lab_order import LabOrder, LabResult
from app.models.tenant.patient import Patient
from app.models.tenant.prescription import Prescription
from app.models.tenant.visit import Visit
from app.schemas.patient import (
    PatientCreate,
    PatientHistoryConsultation,
    PatientHistoryItem,
    PatientHistoryLabOrder,
    PatientHistoryLabResult,
    PatientRead,
    PatientUpdate,
)

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

    # Send WhatsApp/SMS welcome message — best-effort, never blocks registration
    if patient.phone:
        schema = tenant_schema_var.get()
        tenant = (await session.execute(
            select(Tenant).where(Tenant.schema_name == schema)
        )).scalar_one_or_none()
        hospital_name = tenant.hospital_name if tenant else schema
        send_patient_welcome(
            to_phone=patient.phone,
            patient_name=f"{patient.first_name} {patient.last_name}",
            uhid=patient.uhid,
            hospital_name=hospital_name,
        )

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


@router.get("/{patient_id}/history", response_model=List[PatientHistoryItem])
async def get_patient_history(
    patient_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_role(*ALLOWED_ROLES)),
):
    """Return all visits for a patient enriched with consultation, prescription and lab results."""
    patient = await session.get(Patient, patient_id)
    if not patient or not patient.is_active:
        raise HTTPException(status_code=404, detail="Patient not found")

    visits = (
        await session.execute(
            select(Visit)
            .where(Visit.patient_id == patient_id)
            .order_by(Visit.created_at.desc())
        )
    ).scalars().all()

    items: List[PatientHistoryItem] = []
    for visit in visits:
        doctor = await session.get(Doctor, visit.doctor_id) if visit.doctor_id else None
        dept = await session.get(Department, visit.department_id) if visit.department_id else None

        consult = (
            await session.execute(
                select(Consultation).where(Consultation.visit_id == visit.id)
            )
        ).scalar_one_or_none()

        rx = (
            await session.execute(
                select(Prescription).where(Prescription.visit_id == visit.id)
            )
        ).scalar_one_or_none()

        lab_orders_rows = (
            await session.execute(
                select(LabOrder).where(LabOrder.visit_id == visit.id)
            )
        ).scalars().all()

        lab_items: List[PatientHistoryLabOrder] = []
        for lo in lab_orders_rows:
            lab_result = (
                await session.execute(
                    select(LabResult)
                    .where(LabResult.lab_order_id == lo.id)
                    .order_by(LabResult.reported_at.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            lab_items.append(
                PatientHistoryLabOrder(
                    id=lo.id,
                    tests=lo.tests,
                    status=lo.status,
                    result=PatientHistoryLabResult(
                        results=lab_result.results,
                        reported_at=lab_result.reported_at,
                        report_url=lab_result.report_url,
                    ) if lab_result else None,
                )
            )

        items.append(
            PatientHistoryItem(
                visit_id=visit.id,
                visit_date=visit.created_at,
                status=visit.status,
                doctor_name=doctor.full_name if doctor else None,
                department_name=dept.name if dept else None,
                consultation=PatientHistoryConsultation(
                    chief_complaint=consult.chief_complaint,
                    examination=consult.examination,
                    diagnosis_icd10=consult.diagnosis_icd10,
                    notes=consult.notes,
                    follow_up_date=consult.follow_up_date,
                ) if consult else None,
                medicines=rx.medicines if rx else None,
                prescription_instructions=rx.instructions if rx else None,
                lab_orders=lab_items,
            )
        )

    return items
