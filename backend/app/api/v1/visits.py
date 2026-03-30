"""
Visits API — create and manage OPD visits (visit lifecycle state machine).
"""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_role
from app.db.engine import get_session
from app.models.tenant.doctor import Doctor
from app.models.tenant.patient import Patient
from app.models.tenant.visit import Visit
from app.schemas.visit import VisitCreate, VisitRead, VisitStatusUpdate
from app.websocket.manager import ws_manager

router = APIRouter()

_VALID_TRANSITIONS = {
    "registered": {"vitals_done"},
    "vitals_done": {"in_consultation"},
    "in_consultation": {"prescription_done"},
    "prescription_done": {"billing_pending"},
    "billing_pending": {"closed"},
    "closed": set(),
}

ALLOWED_ROLES = ("receptionist", "nurse", "doctor", "billing_officer", "hospital_admin", "super_admin")


@router.post("", response_model=VisitRead, status_code=status.HTTP_201_CREATED)
async def create_visit(
    payload: VisitCreate,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role(*ALLOWED_ROLES)),
):
    visit = Visit(
        id=uuid.uuid4(),
        patient_id=payload.patient_id,
        doctor_id=payload.doctor_id,
        appointment_id=payload.appointment_id,
        status="registered",
    )
    session.add(visit)
    await session.commit()
    await session.refresh(visit)

    patient = await session.get(Patient, visit.patient_id)
    doctor = await session.get(Doctor, visit.doctor_id)

    result = VisitRead.model_validate(visit)
    result.patient_name = f"{patient.first_name} {patient.last_name}" if patient else None
    result.doctor_name = doctor.full_name if doctor else None
    return result


@router.get("", response_model=List[VisitRead])
async def list_visits(
    patient_id: Optional[uuid.UUID] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    open_only: bool = Query(False),
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_role(*ALLOWED_ROLES)),
):
    stmt = select(Visit)
    if patient_id:
        stmt = stmt.where(Visit.patient_id == patient_id)
    if status_filter:
        stmt = stmt.where(Visit.status == status_filter)
    if open_only:
        stmt = stmt.where(Visit.closed_at == None)  # noqa: E711
    stmt = stmt.order_by(Visit.created_at.desc())

    rows = (await session.execute(stmt)).scalars().all()
    items = []
    for v in rows:
        item = VisitRead.model_validate(v)
        patient = await session.get(Patient, v.patient_id)
        doctor = await session.get(Doctor, v.doctor_id)
        item.patient_name = f"{patient.first_name} {patient.last_name}" if patient else None
        item.doctor_name = doctor.full_name if doctor else None
        items.append(item)
    return items


@router.get("/{visit_id}", response_model=VisitRead)
async def get_visit(
    visit_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_role(*ALLOWED_ROLES)),
):
    visit = await session.get(Visit, visit_id)
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    patient = await session.get(Patient, visit.patient_id)
    doctor = await session.get(Doctor, visit.doctor_id)
    result = VisitRead.model_validate(visit)
    result.patient_name = f"{patient.first_name} {patient.last_name}" if patient else None
    result.doctor_name = doctor.full_name if doctor else None
    return result


@router.patch("/{visit_id}/status", response_model=VisitRead)
async def transition_visit_status(
    visit_id: uuid.UUID,
    payload: VisitStatusUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role(*ALLOWED_ROLES)),
):
    visit = await session.get(Visit, visit_id)
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")

    allowed = _VALID_TRANSITIONS.get(visit.status, set())
    if payload.status not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot transition from '{visit.status}' to '{payload.status}'",
        )

    visit.status = payload.status
    if payload.status == "closed":
        visit.closed_at = datetime.now(timezone.utc)

    await session.commit()
    await session.refresh(visit)

    # Broadcast visit stage change
    tenant = current_user.get("tenant_schema", "public")
    await ws_manager.broadcast(tenant, "visit:update", {
        "event": "visit_status_changed",
        "visit_id": str(visit.id),
        "status": visit.status,
    })

    patient = await session.get(Patient, visit.patient_id)
    doctor = await session.get(Doctor, visit.doctor_id)
    result = VisitRead.model_validate(visit)
    result.patient_name = f"{patient.first_name} {patient.last_name}" if patient else None
    result.doctor_name = doctor.full_name if doctor else None
    return result
