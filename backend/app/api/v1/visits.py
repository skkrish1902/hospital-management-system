"""
Visits API — create and manage OPD visits (visit lifecycle state machine).
"""
import uuid
from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_role
from app.db.engine import get_session
from app.models.tenant.department import Department
from app.models.tenant.doctor import Doctor
from app.models.tenant.lab_order import LabOrder
from app.models.tenant.patient import Patient
from app.models.tenant.pharmacy_queue import PharmacyQueue
from app.models.tenant.prescription import Prescription
from app.models.tenant.nurse_department import NurseDepartment
from app.models.tenant.queue_token import QueueToken
from app.models.tenant.visit import Visit
from app.schemas.visit import VisitCreate, VisitDispatch, VisitRead, VisitStatusUpdate
from app.websocket.manager import ws_manager

router = APIRouter()

_VALID_TRANSITIONS = {
    "registered": {"vitals_recorded"},
    "vitals_recorded": {"vitals_done"},
    "vitals_done": {"in_consultation"},
    "in_consultation": {"prescription_done"},
    "prescription_done": {"dispatched_pharmacy", "dispatched_lab", "billing_pending", "closed"},
    "dispatched_pharmacy": {"dispatched_lab", "dispatched_both", "billing_pending", "closed"},
    "dispatched_lab": {"dispatched_pharmacy", "dispatched_both", "billing_pending", "closed"},
    "dispatched_both": {"billing_pending", "closed"},
    "billing_pending": {"closed"},
    "closed": set(),
}

ALLOWED_ROLES = ("receptionist", "nurse", "doctor", "billing_officer", "hospital_admin", "super_admin")


async def _complete_queue_token(visit: Visit, session: AsyncSession) -> None:
    """Mark today's checked-in queue token for this patient as completed."""
    today_start = datetime.combine(date.today(), datetime.min.time()).replace(tzinfo=timezone.utc)
    token = (await session.execute(
        select(QueueToken)
        .where(
            and_(
                QueueToken.patient_id == visit.patient_id,
                QueueToken.status == "checked_in",
                QueueToken.issued_at >= today_start,
            )
        )
        .order_by(QueueToken.issued_at.desc())
        .limit(1)
    )).scalars().first()
    if token:
        token.status = "completed"
        token.completed_at = datetime.now(timezone.utc)


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
        department_id=payload.department_id,
        status="registered",
    )
    session.add(visit)
    await session.commit()
    await session.refresh(visit)

    patient = await session.get(Patient, visit.patient_id)
    doctor = await session.get(Doctor, visit.doctor_id) if visit.doctor_id else None
    dept = await session.get(Department, visit.department_id) if visit.department_id else None

    result = VisitRead.model_validate(visit)
    result.patient_name = f"{patient.first_name} {patient.last_name}" if patient else None
    result.doctor_name = doctor.full_name if doctor else None
    result.department_name = dept.name if dept else None
    result.doctor_consultation_fee = float(doctor.consultation_fee) if doctor else None
    return result


@router.get("", response_model=List[VisitRead])
async def list_visits(
    patient_id: Optional[uuid.UUID] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    department_id: Optional[uuid.UUID] = Query(None),
    open_only: bool = Query(False),
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role(*ALLOWED_ROLES)),
):
    stmt = select(Visit)
    if patient_id:
        stmt = stmt.where(Visit.patient_id == patient_id)
    if status_filter:
        stmt = stmt.where(Visit.status == status_filter)
    if open_only:
        stmt = stmt.where(Visit.closed_at == None)  # noqa: E711

    # Nurses are restricted to only their assigned departments — enforced server-side
    if current_user.get("role") == "nurse":
        nurse_id = uuid.UUID(current_user["sub"])
        nd_rows = (await session.execute(
            select(NurseDepartment.department_id).where(NurseDepartment.user_id == nurse_id)
        )).scalars().all()
        assigned_dept_ids = list(nd_rows)
        if not assigned_dept_ids:
            return []  # Nurse has no departments assigned — show nothing
        # If caller also passed a specific department_id, honour it only if it's in the nurse's list
        if department_id:
            if department_id not in assigned_dept_ids:
                return []  # Requested dept not assigned to this nurse
            stmt = stmt.where(Visit.department_id == department_id)
        else:
            stmt = stmt.where(Visit.department_id.in_(assigned_dept_ids))
    elif department_id:
        stmt = stmt.where(Visit.department_id == department_id)

    stmt = stmt.order_by(Visit.created_at.desc())

    rows = (await session.execute(stmt)).scalars().all()
    items = []
    for v in rows:
        item = VisitRead.model_validate(v)
        patient = await session.get(Patient, v.patient_id)
        doctor = await session.get(Doctor, v.doctor_id) if v.doctor_id else None
        dept = await session.get(Department, v.department_id) if v.department_id else None
        item.patient_name = f"{patient.first_name} {patient.last_name}" if patient else None
        item.doctor_name = doctor.full_name if doctor else None
        item.department_name = dept.name if dept else None
        item.doctor_consultation_fee = float(doctor.consultation_fee) if doctor else None
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
    doctor = await session.get(Doctor, visit.doctor_id) if visit.doctor_id else None
    dept = await session.get(Department, visit.department_id) if visit.department_id else None
    result = VisitRead.model_validate(visit)
    result.patient_name = f"{patient.first_name} {patient.last_name}" if patient else None
    result.doctor_name = doctor.full_name if doctor else None
    result.department_name = dept.name if dept else None
    result.doctor_consultation_fee = float(doctor.consultation_fee) if doctor else None
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
        await _complete_queue_token(visit, session)

    await session.commit()
    await session.refresh(visit)

    # Broadcast visit stage change
    tenant = current_user.get("tenant_schema", "public")
    if payload.status == "closed":
        await ws_manager.broadcast(tenant, "queue:update", {"event": "token_completed", "patient_id": str(visit.patient_id)})
    await ws_manager.broadcast(tenant, "visit:update", {
        "event": "visit_status_changed",
        "visit_id": str(visit.id),
        "status": visit.status,
    })

    patient = await session.get(Patient, visit.patient_id)
    doctor = await session.get(Doctor, visit.doctor_id) if visit.doctor_id else None
    dept = await session.get(Department, visit.department_id) if visit.department_id else None
    result = VisitRead.model_validate(visit)
    result.patient_name = f"{patient.first_name} {patient.last_name}" if patient else None
    result.doctor_name = doctor.full_name if doctor else None
    result.department_name = dept.name if dept else None
    result.doctor_consultation_fee = float(doctor.consultation_fee) if doctor else None
    return result


@router.post("/{visit_id}/dispatch", response_model=VisitRead)
async def dispatch_visit(
    visit_id: uuid.UUID,
    payload: VisitDispatch,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role("nurse", "hospital_admin", "super_admin")),
):
    """
    Nurse dispatch after prescription_done:
      - close    → visit → closed (hand prescription to patient, no extra billing)
      - billing  → visit → billing_pending (additional charges needed)
      - pharmacy → create PharmacyQueue + visit → dispatched_pharmacy
      - lab      → activate LabOrder + visit → dispatched_lab
    pharmacy and lab are independent — both can be dispatched for the same visit.
    """
    visit = await session.get(Visit, visit_id)
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")

    _DISPATCH_ALLOWED = {"prescription_done", "dispatched_pharmacy", "dispatched_lab", "dispatched_both"}
    if visit.status not in _DISPATCH_ALLOWED:
        raise HTTPException(
            status_code=400,
            detail=f"Dispatch only allowed from prescription/dispatch states (current: {visit.status})",
        )

    if payload.action == "close":
        visit.status = "closed"
        visit.closed_at = datetime.now(timezone.utc)
        await _complete_queue_token(visit, session)

    elif payload.action == "billing":
        visit.status = "billing_pending"

    elif payload.action == "pharmacy":
        rx = (await session.execute(
            select(Prescription).where(Prescription.visit_id == visit_id)
        )).scalar_one_or_none()
        if not rx:
            raise HTTPException(status_code=400, detail="No prescription found for this visit")
        # Idempotent: only create if no PharmacyQueue exists yet
        existing_pq = (await session.execute(
            select(PharmacyQueue).where(PharmacyQueue.prescription_id == rx.id)
        )).scalar_one_or_none()
        if not existing_pq:
            session.add(PharmacyQueue(id=uuid.uuid4(), prescription_id=rx.id, status="pending"))
        # If lab was already dispatched, both are now done
        visit.status = "dispatched_both" if visit.status == "dispatched_lab" else "dispatched_pharmacy"
        await _complete_queue_token(visit, session)

    elif payload.action == "lab":
        lab_order = (await session.execute(
            select(LabOrder).where(LabOrder.visit_id == visit_id)
        )).scalar_one_or_none()
        if not lab_order:
            raise HTTPException(status_code=400, detail="No lab order found for this visit — doctor must add lab tests first")
        lab_order.status = "sample_collected"
        # If pharmacy was already dispatched, both are now done
        visit.status = "dispatched_both" if visit.status == "dispatched_pharmacy" else "dispatched_lab"
        await _complete_queue_token(visit, session)

    await session.commit()
    await session.refresh(visit)

    tenant = current_user.get("tenant_schema", "public")
    await ws_manager.broadcast(tenant, "visit:update", {
        "event": "visit_dispatched",
        "visit_id": str(visit.id),
        "action": payload.action,
        "status": visit.status,
    })
    if payload.action == "close":
        await ws_manager.broadcast(tenant, "queue:update", {"event": "token_completed", "patient_id": str(visit.patient_id)})
    if payload.action in ("pharmacy", "lab"):
        await ws_manager.broadcast(tenant, "queue:update", {"event": "token_completed", "patient_id": str(visit.patient_id)})
    if payload.action == "pharmacy":
        await ws_manager.broadcast(tenant, "pharmacy:update", {
            "event": "pharmacy_queue_created",
            "visit_id": str(visit.id),
        })

    patient = await session.get(Patient, visit.patient_id)
    doctor = await session.get(Doctor, visit.doctor_id) if visit.doctor_id else None
    dept = await session.get(Department, visit.department_id) if visit.department_id else None
    result = VisitRead.model_validate(visit)
    result.patient_name = f"{patient.first_name} {patient.last_name}" if patient else None
    result.doctor_name = doctor.full_name if doctor else None
    result.department_name = dept.name if dept else None
    result.doctor_consultation_fee = float(doctor.consultation_fee) if doctor else None
    return result
