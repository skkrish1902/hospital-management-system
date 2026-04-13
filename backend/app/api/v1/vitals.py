"""
Vitals API — nurse records patient vitals for a visit.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_role, require_feature
from app.db.engine import get_session
from app.models.tenant.patient import Patient
from app.models.tenant.visit import Visit
from app.models.tenant.vitals import Vitals
from app.schemas.vitals import VitalsCreate, VitalsRead
from app.websocket.manager import ws_manager

router = APIRouter(dependencies=[Depends(require_feature("vitals"))])


@router.post("", response_model=VitalsRead, status_code=status.HTTP_201_CREATED)
async def record_vitals(
    payload: VitalsCreate,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role("nurse", "doctor", "hospital_admin", "super_admin")),
):
    visit = await session.get(Visit, payload.visit_id)
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")

    patient = await session.get(Patient, visit.patient_id)
    vitals = Vitals(
        id=uuid.uuid4(),
        uhid=patient.uhid if patient else None,
        recorded_by_user_id=uuid.UUID(current_user["sub"]),
        **payload.model_dump(),
    )
    session.add(vitals)

    # Advance directly to vitals_done — automatically sends patient to doctor queue
    if visit.status == "registered":
        visit.status = "vitals_done"

    await session.commit()
    await session.refresh(vitals)

    # Notify doctor queue
    tenant = current_user.get("tenant_schema", "public")
    await ws_manager.broadcast(tenant, "visit:update", {
        "event": "vitals_recorded",
        "visit_id": str(visit.id),
        "patient_id": str(visit.patient_id),
    })

    return vitals


@router.get("/{visit_id}", response_model=VitalsRead)
async def get_vitals(
    visit_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_role("nurse", "doctor", "hospital_admin", "super_admin")),
):
    result = await session.execute(
        select(Vitals).where(Vitals.visit_id == visit_id).order_by(Vitals.recorded_at.desc()).limit(1)
    )
    vitals = result.scalar_one_or_none()
    if not vitals:
        raise HTTPException(status_code=404, detail="Vitals not found for this visit")
    return vitals
