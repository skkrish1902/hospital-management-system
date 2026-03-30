"""
Prescriptions API — build and retrieve prescriptions for a visit.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_role
from app.db.engine import get_session
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

    medicines_data = (
        [m.model_dump() for m in payload.medicines] if payload.medicines else None
    )
    prescription = Prescription(
        id=uuid.uuid4(),
        visit_id=payload.visit_id,
        medicines=medicines_data,
        instructions=payload.instructions,
    )
    session.add(prescription)

    # Advance visit status after prescription is written
    if visit.status == "in_consultation":
        visit.status = "prescription_done"

    await session.commit()
    await session.refresh(prescription)

    # Notify pharmacy
    tenant = current_user.get("tenant_schema", "public")
    await ws_manager.broadcast(tenant, "pharmacy:update", {
        "event": "prescription_created",
        "prescription_id": str(prescription.id),
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
