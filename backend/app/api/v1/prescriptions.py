"""
Prescriptions API — build and retrieve prescriptions for a visit.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_role
from app.db.engine import get_session
from app.models.tenant.lab_order import LabOrder
from app.models.tenant.patient import Patient
from app.models.tenant.prescription import Prescription
from app.models.tenant.visit import Visit
from app.schemas.prescription import PrescriptionCreate, PrescriptionRead, PrescriptionUpdate
from app.websocket.manager import ws_manager

router = APIRouter()


@router.post("", response_model=PrescriptionRead, status_code=status.HTTP_201_CREATED)
async def create_prescription(
    payload: PrescriptionCreate,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role("doctor", "hospital_admin", "super_admin")),
):
    visit = await session.get(Visit, payload.visit_id)
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")

    patient = await session.get(Patient, visit.patient_id)
    uhid = patient.uhid if patient else None

    medicines_data = (
        [m.model_dump() for m in payload.medicines] if payload.medicines else None
    )

    # Upsert — each visit has at most one prescription
    existing_rx = (await session.execute(
        select(Prescription).where(Prescription.visit_id == payload.visit_id).limit(1)
    )).scalar_one_or_none()

    if existing_rx:
        existing_rx.medicines = medicines_data
        existing_rx.instructions = payload.instructions
        prescription = existing_rx
    else:
        prescription = Prescription(
            id=uuid.uuid4(),
            visit_id=payload.visit_id,
            uhid=uhid,
            medicines=medicines_data,
            instructions=payload.instructions,
        )
        session.add(prescription)

    # If doctor included lab tests, upsert a LabOrder alongside the prescription
    if payload.lab_tests:
        existing_order = (await session.execute(
            select(LabOrder).where(LabOrder.visit_id == payload.visit_id).limit(1)
        )).scalar_one_or_none()
        if existing_order:
            existing_order.tests = [t.model_dump() for t in payload.lab_tests]
            existing_order.status = "ordered"
        else:
            lab_order = LabOrder(
                id=uuid.uuid4(),
                visit_id=payload.visit_id,
                uhid=uhid,
                tests=[t.model_dump() for t in payload.lab_tests],
                status="ordered",
            )
            session.add(lab_order)

    # Advance visit status after prescription is written
    if visit.status == "in_consultation":
        visit.status = "prescription_done"

    await session.commit()
    await session.refresh(prescription)

    # Notify pharmacy and nurse dispatch queue
    tenant = current_user.get("tenant_schema", "public")
    await ws_manager.broadcast(tenant, "pharmacy:update", {
        "event": "prescription_created",
        "prescription_id": str(prescription.id),
        "visit_id": str(prescription.visit_id),
        "has_lab_tests": bool(payload.lab_tests),
    })
    await ws_manager.broadcast(tenant, "visit:update", {
        "event": "prescription_saved",
        "visit_id": str(prescription.visit_id),
    })

    return prescription


@router.patch("/{visit_id}", response_model=PrescriptionRead)
async def update_prescription(
    visit_id: uuid.UUID,
    payload: PrescriptionUpdate,
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_role("doctor", "hospital_admin", "super_admin")),
):
    rx = (await session.execute(
        select(Prescription).where(Prescription.visit_id == visit_id)
    )).scalar_one_or_none()
    if not rx:
        raise HTTPException(status_code=404, detail="Prescription not found for this visit")

    if payload.medicines is not None:
        rx.medicines = [m.model_dump() for m in payload.medicines]
    if payload.instructions is not None:
        rx.instructions = payload.instructions

    await session.commit()
    await session.refresh(rx)
    return rx


@router.get("/{visit_id}", response_model=PrescriptionRead)
async def get_prescription(
    visit_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_role("doctor", "nurse", "pharmacist", "hospital_admin", "super_admin")),
):
    rx = (await session.execute(
        select(Prescription).where(Prescription.visit_id == visit_id)
    )).scalar_one_or_none()
    if not rx:
        raise HTTPException(status_code=404, detail="Prescription not found for this visit")
    return rx
