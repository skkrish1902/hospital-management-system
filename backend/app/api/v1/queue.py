"""
Queue tokens API — priority-based token allocation engine.

Priority ordering for token_no assignment:
  emergency > senior_citizen > normal

Token numbering is per-department per-day when department_id is provided,
falling back to per-queue_type per-day for legacy/undepartment tokens.
Daily sequence resets at midnight.
"""
import uuid
from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, require_role
from app.db.engine import get_session
from app.models.tenant.department import Department
from app.models.tenant.doctor import Doctor
from app.models.tenant.patient import Patient
from app.models.tenant.queue_token import QueueToken
from app.models.tenant.visit import Visit
from app.schemas.queue import QueueTokenCreate, QueueTokenRead, QueueTokenStatusUpdate
from app.websocket.manager import ws_manager

router = APIRouter()

_PRIORITY_ORDER = {"emergency": 0, "senior_citizen": 1, "normal": 2}


async def _next_token_no(
    session: AsyncSession,
    queue_type: str,
    department_id: Optional[uuid.UUID] = None,
) -> int:
    """Daily sequential token number, scoped per department when provided."""
    today_start = datetime.combine(date.today(), datetime.min.time()).replace(tzinfo=timezone.utc)
    filters = [QueueToken.issued_at >= today_start]
    if department_id:
        filters.append(QueueToken.department_id == department_id)
    else:
        filters.append(QueueToken.queue_type == queue_type)
    result = await session.execute(
        select(func.max(QueueToken.token_no)).where(and_(*filters))
    )
    max_no = result.scalar()
    return (max_no or 0) + 1


@router.post("", response_model=QueueTokenRead, status_code=status.HTTP_201_CREATED)
async def issue_token(
    payload: QueueTokenCreate,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role("receptionist", "hospital_admin", "super_admin")),
):
    patient = await session.get(Patient, payload.patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    token_no = await _next_token_no(session, payload.queue_type, payload.department_id)
    token = QueueToken(
        id=uuid.uuid4(),
        patient_id=payload.patient_id,
        appointment_id=payload.appointment_id,
        department_id=payload.department_id,
        doctor_id=payload.doctor_id,
        token_no=token_no,
        queue_type=payload.queue_type,
        priority=payload.priority,
        status="waiting",
    )
    session.add(token)
    await session.commit()
    await session.refresh(token)

    dept = await session.get(Department, payload.department_id) if payload.department_id else None
    doctor = await session.get(Doctor, payload.doctor_id) if payload.doctor_id else None

    # Broadcast to WebSocket subscribers
    tenant = current_user.get("tenant_schema", "public")
    await ws_manager.broadcast(tenant, "queue:update", {
        "event": "token_issued",
        "queue_type": token.queue_type,
        "department_id": str(token.department_id) if token.department_id else None,
        "token_no": token.token_no,
        "priority": token.priority,
        "patient_id": str(token.patient_id),
        "patient_name": f"{patient.first_name} {patient.last_name}",
    })

    result = QueueTokenRead.model_validate(token)
    result.patient_name = f"{patient.first_name} {patient.last_name}"
    result.patient_phone = patient.phone
    result.department_name = dept.name if dept else None
    result.doctor_name = doctor.full_name if doctor else None
    return result


@router.get("", response_model=List[QueueTokenRead])
async def list_queue(
    queue_type: Optional[str] = Query(None),
    department_id: Optional[uuid.UUID] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_role("receptionist", "nurse", "doctor", "hospital_admin", "super_admin")),
):
    """Returns today's queue, sorted by priority then token_no."""
    today_start = datetime.combine(date.today(), datetime.min.time()).replace(tzinfo=timezone.utc)
    stmt = (
        select(QueueToken, Patient)
        .join(Patient, QueueToken.patient_id == Patient.id)
        .where(QueueToken.issued_at >= today_start)
    )
    if queue_type:
        stmt = stmt.where(QueueToken.queue_type == queue_type)
    if department_id:
        stmt = stmt.where(QueueToken.department_id == department_id)
    if status_filter:
        stmt = stmt.where(QueueToken.status == status_filter)

    # Sort: priority ASC (emergency=0), then token_no ASC
    stmt = stmt.order_by(
        case(
            (QueueToken.priority == "emergency", 0),
            (QueueToken.priority == "senior_citizen", 1),
            else_=2,
        ),
        QueueToken.token_no,
    )

    rows = (await session.execute(stmt)).all()
    items = []
    for token, patient in rows:
        item = QueueTokenRead.model_validate(token)
        item.patient_name = f"{patient.first_name} {patient.last_name}"
        item.patient_phone = patient.phone
        if token.department_id:
            dept = await session.get(Department, token.department_id)
            item.department_name = dept.name if dept else None
        if token.doctor_id:
            doctor = await session.get(Doctor, token.doctor_id)
            item.doctor_name = doctor.full_name if doctor else None
        items.append(item)
    return items


@router.patch("/{token_id}/status", response_model=QueueTokenRead)
async def update_token_status(
    token_id: uuid.UUID,
    payload: QueueTokenStatusUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role("receptionist", "nurse", "doctor", "hospital_admin", "super_admin")),
):
    token = await session.get(QueueToken, token_id)
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    token.status = payload.status
    if payload.status == "called":
        token.called_at = datetime.now(timezone.utc)
    elif payload.status == "completed":
        token.completed_at = datetime.now(timezone.utc)

    await session.commit()
    await session.refresh(token)

    patient = await session.get(Patient, token.patient_id)
    tenant = current_user.get("tenant_schema", "public")
    await ws_manager.broadcast(tenant, "queue:update", {
        "event": "token_updated",
        "token_id": str(token.id),
        "token_no": token.token_no,
        "queue_type": token.queue_type,
        "status": token.status,
    })

    result = QueueTokenRead.model_validate(token)
    if patient:
        result.patient_name = f"{patient.first_name} {patient.last_name}"
        result.patient_phone = patient.phone
    return result


@router.post("/{token_id}/checkin", response_model=QueueTokenRead)
async def checkin_walkin(
    token_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role("receptionist", "nurse", "hospital_admin", "super_admin")),
):
    """
    Check-in a walk-in queue token:
    1. Token status → 'called'
    2. Create a Visit(status='registered') linked to this token's patient + department
    3. Broadcast visit:update so NurseVitalsPage picks it up in real-time
    """
    token = await session.get(QueueToken, token_id)
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")
    if token.status not in ("waiting", "called"):
        raise HTTPException(status_code=400, detail=f"Cannot check-in token with status '{token.status}'")

    # Idempotent: if visit already created for this token, don't duplicate
    existing_visit = (await session.execute(
        select(Visit).where(Visit.appointment_id == None, Visit.patient_id == token.patient_id, Visit.status != "closed")  # noqa: E711
    )).scalars().all()
    # More precise: check via token link stored on token itself (we store visit_id on token if available)
    # Since we don't have a direct FK, match by patient + department + same day
    from datetime import date as _date
    today_start = datetime.combine(_date.today(), datetime.min.time()).replace(tzinfo=timezone.utc)
    dup = (await session.execute(
        select(Visit).where(
            Visit.patient_id == token.patient_id,
            Visit.department_id == token.department_id,
            Visit.created_at >= today_start,
            Visit.status != "closed",
        )
    )).scalar_one_or_none()
    if dup:
        # Already checked in — just update token status
        token.status = "called"
        token.called_at = datetime.now(timezone.utc)
        await session.commit()
        await session.refresh(token)
        patient = await session.get(Patient, token.patient_id)
        result = QueueTokenRead.model_validate(token)
        if patient:
            result.patient_name = f"{patient.first_name} {patient.last_name}"
            result.patient_phone = patient.phone
        return result

    # Mark token called
    token.status = "called"
    token.called_at = datetime.now(timezone.utc)

    # Create Visit (doctor_id comes from the pre-selected doctor on the token)
    visit = Visit(
        id=uuid.uuid4(),
        patient_id=token.patient_id,
        doctor_id=token.doctor_id,
        appointment_id=None,
        department_id=token.department_id,
        status="registered",
    )
    session.add(visit)
    await session.commit()
    await session.refresh(token)
    await session.refresh(visit)

    patient = await session.get(Patient, token.patient_id)
    tenant = current_user.get("tenant_schema", "public")

    # Broadcast token status change
    await ws_manager.broadcast(tenant, "queue:update", {
        "event": "token_updated",
        "token_id": str(token.id),
        "token_no": token.token_no,
        "status": token.status,
    })
    # Broadcast new visit → NurseVitalsPage picks it up immediately
    await ws_manager.broadcast(tenant, "visit:update", {
        "event": "visit_registered",
        "visit_id": str(visit.id),
        "patient_id": str(visit.patient_id),
        "department_id": str(visit.department_id) if visit.department_id else None,
    })

    result = QueueTokenRead.model_validate(token)
    if patient:
        result.patient_name = f"{patient.first_name} {patient.last_name}"
        result.patient_phone = patient.phone
    if token.department_id:
        dept = await session.get(Department, token.department_id)
        result.department_name = dept.name if dept else None
    return result
