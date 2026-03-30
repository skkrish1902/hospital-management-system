"""
Queue tokens API — priority-based token allocation engine.

Priority ordering for token_no assignment:
  emergency > senior_citizen > normal

Daily sequence resets are NOT implemented in v1 — tokens are sequential per-day per queue_type.
"""
import uuid
from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, require_role
from app.db.engine import get_session
from app.models.tenant.patient import Patient
from app.models.tenant.queue_token import QueueToken
from app.schemas.queue import QueueTokenCreate, QueueTokenRead, QueueTokenStatusUpdate
from app.websocket.manager import ws_manager

router = APIRouter()

_PRIORITY_ORDER = {"emergency": 0, "senior_citizen": 1, "normal": 2}


async def _next_token_no(session: AsyncSession, queue_type: str) -> int:
    """Daily sequential token number per queue_type."""
    today_start = datetime.combine(date.today(), datetime.min.time()).replace(tzinfo=timezone.utc)
    result = await session.execute(
        select(func.max(QueueToken.token_no)).where(
            and_(
                QueueToken.queue_type == queue_type,
                QueueToken.issued_at >= today_start,
            )
        )
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

    token_no = await _next_token_no(session, payload.queue_type)
    token = QueueToken(
        id=uuid.uuid4(),
        patient_id=payload.patient_id,
        appointment_id=payload.appointment_id,
        token_no=token_no,
        queue_type=payload.queue_type,
        priority=payload.priority,
        status="waiting",
    )
    session.add(token)
    await session.commit()
    await session.refresh(token)

    # Broadcast to WebSocket subscribers
    tenant = current_user.get("tenant_schema", "public")
    await ws_manager.broadcast(tenant, "queue:update", {
        "event": "token_issued",
        "queue_type": token.queue_type,
        "token_no": token.token_no,
        "priority": token.priority,
        "patient_id": str(token.patient_id),
        "patient_name": f"{patient.first_name} {patient.last_name}",
    })

    result = QueueTokenRead.model_validate(token)
    result.patient_name = f"{patient.first_name} {patient.last_name}"
    result.patient_phone = patient.phone
    return result


@router.get("", response_model=List[QueueTokenRead])
async def list_queue(
    queue_type: Optional[str] = Query(None),
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
