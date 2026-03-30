"""
Appointments API — booking, slot availability, reschedule, cancel, check-in.

Check-in flow:
  appointment → confirmed/scheduled → creates Visit + QueueToken (consultation)
             → broadcasts queue:update → marks appointment checked_in
"""
import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_role
from app.db.engine import get_session
from app.models.tenant.appointment import Appointment
from app.models.tenant.doctor import Doctor
from app.models.tenant.patient import Patient
from app.models.tenant.queue_token import QueueToken
from app.models.tenant.visit import Visit
from app.schemas.appointment import (
    AppointmentCreate,
    AppointmentRead,
    AppointmentReschedule,
    AppointmentStatusUpdate,
    CheckInResult,
    SlotInfo,
)
from app.websocket.manager import ws_manager

router = APIRouter()

# Clinic operating hours (UTC+5:30 handled by caller; backend stores UTC)
_SLOT_DURATION_MINUTES = 15
_DAY_START_HOUR = 9   # 09:00 local = stored as-is (naive datetime in DB)
_DAY_END_HOUR = 17    # 17:00
_VALID_CHECK_IN_STATUSES = {"scheduled", "confirmed"}


def _build_slot_times(target_date: date) -> List[datetime]:
    """Generate all 15-min slot datetimes for a given calendar date."""
    slots = []
    current = datetime.combine(target_date, time(_DAY_START_HOUR, 0), tzinfo=timezone.utc)
    end = datetime.combine(target_date, time(_DAY_END_HOUR, 0), tzinfo=timezone.utc)
    while current < end:
        slots.append(current)
        current += timedelta(minutes=_SLOT_DURATION_MINUTES)
    return slots


async def _enrich(appt: Appointment, session: AsyncSession) -> AppointmentRead:
    read = AppointmentRead.model_validate(appt)
    patient = await session.get(Patient, appt.patient_id)
    if patient:
        read.patient_name = f"{patient.first_name} {patient.last_name}"
    doctor = await session.get(Doctor, appt.doctor_id)
    if doctor:
        read.doctor_name = doctor.full_name
    return read


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("", response_model=List[AppointmentRead])
async def list_appointments(
    appt_date: Optional[date] = Query(None, alias="date"),
    doctor_id: Optional[uuid.UUID] = None,
    patient_id: Optional[uuid.UUID] = None,
    appt_status: Optional[str] = Query(None, alias="status"),
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_role(
        "receptionist", "nurse", "doctor", "hospital_admin", "super_admin",
    )),
):
    stmt = select(Appointment).order_by(Appointment.slot_time)
    if appt_date:
        day_start = datetime.combine(appt_date, time.min, tzinfo=timezone.utc)
        day_end = datetime.combine(appt_date, time.max, tzinfo=timezone.utc)
        stmt = stmt.where(and_(
            Appointment.slot_time >= day_start,
            Appointment.slot_time <= day_end,
        ))
    if doctor_id:
        stmt = stmt.where(Appointment.doctor_id == doctor_id)
    if patient_id:
        stmt = stmt.where(Appointment.patient_id == patient_id)
    if appt_status:
        stmt = stmt.where(Appointment.status == appt_status)
    rows = (await session.execute(stmt)).scalars().all()
    return [await _enrich(a, session) for a in rows]


# ── Slot availability ─────────────────────────────────────────────────────────

@router.get("/slots", response_model=List[SlotInfo])
async def get_slots(
    doctor_id: uuid.UUID,
    slot_date: date = Query(..., alias="date"),
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_role(
        "receptionist", "hospital_admin", "super_admin",
    )),
):
    all_slots = _build_slot_times(slot_date)
    day_start = datetime.combine(slot_date, time.min, tzinfo=timezone.utc)
    day_end = datetime.combine(slot_date, time.max, tzinfo=timezone.utc)

    booked_stmt = select(Appointment.slot_time).where(
        and_(
            Appointment.doctor_id == doctor_id,
            Appointment.slot_time >= day_start,
            Appointment.slot_time <= day_end,
            Appointment.status.notin_(["cancelled", "no_show"]),
        )
    )
    booked_times = set((await session.execute(booked_stmt)).scalars().all())

    return [
        SlotInfo(slot_time=s, is_available=(s not in booked_times))
        for s in all_slots
    ]


# ── Create / Book ─────────────────────────────────────────────────────────────

@router.post("", response_model=AppointmentRead, status_code=status.HTTP_201_CREATED)
async def book_appointment(
    payload: AppointmentCreate,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role(
        "receptionist", "hospital_admin", "super_admin",
    )),
):
    # Verify patient and doctor exist
    patient = await session.get(Patient, payload.patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    doctor = await session.get(Doctor, payload.doctor_id)
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")

    # Conflict check — same doctor, same slot
    conflict = (await session.execute(
        select(Appointment).where(
            and_(
                Appointment.doctor_id == payload.doctor_id,
                Appointment.slot_time == payload.slot_time,
                Appointment.status.notin_(["cancelled", "no_show"]),
            )
        )
    )).scalar_one_or_none()
    if conflict:
        raise HTTPException(status_code=409, detail="Slot already booked for this doctor")

    appt = Appointment(
        id=uuid.uuid4(),
        patient_id=payload.patient_id,
        doctor_id=payload.doctor_id,
        slot_time=payload.slot_time,
        type=payload.type,
        notes=payload.notes,
        status="scheduled",
        booked_by_user_id=current_user.get("user_id"),
    )
    session.add(appt)
    await session.commit()
    await session.refresh(appt)

    tenant = current_user.get("tenant_schema", "public")
    await ws_manager.broadcast(tenant, "appointment:update", {
        "event": "appointment_booked",
        "appointment_id": str(appt.id),
        "slot_time": appt.slot_time.isoformat(),
    })

    return await _enrich(appt, session)


# ── Single get ────────────────────────────────────────────────────────────────

@router.get("/{appt_id}", response_model=AppointmentRead)
async def get_appointment(
    appt_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_role(
        "receptionist", "nurse", "doctor", "hospital_admin", "super_admin",
    )),
):
    appt = await session.get(Appointment, appt_id)
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")
    return await _enrich(appt, session)


# ── Reschedule ────────────────────────────────────────────────────────────────

@router.patch("/{appt_id}/reschedule", response_model=AppointmentRead)
async def reschedule_appointment(
    appt_id: uuid.UUID,
    payload: AppointmentReschedule,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role(
        "receptionist", "hospital_admin", "super_admin",
    )),
):
    appt = await session.get(Appointment, appt_id)
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")
    if appt.status in ("cancelled", "completed", "checked_in"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot reschedule appointment with status '{appt.status}'",
        )

    # Conflict check on new slot
    conflict = (await session.execute(
        select(Appointment).where(
            and_(
                Appointment.doctor_id == appt.doctor_id,
                Appointment.slot_time == payload.slot_time,
                Appointment.id != appt_id,
                Appointment.status.notin_(["cancelled", "no_show"]),
            )
        )
    )).scalar_one_or_none()
    if conflict:
        raise HTTPException(status_code=409, detail="New slot already booked for this doctor")

    appt.slot_time = payload.slot_time
    if payload.notes is not None:
        appt.notes = payload.notes
    appt.status = "scheduled"

    await session.commit()
    await session.refresh(appt)

    tenant = current_user.get("tenant_schema", "public")
    await ws_manager.broadcast(tenant, "appointment:update", {
        "event": "appointment_rescheduled",
        "appointment_id": str(appt.id),
        "new_slot_time": appt.slot_time.isoformat(),
    })

    return await _enrich(appt, session)


# ── Cancel ────────────────────────────────────────────────────────────────────

@router.patch("/{appt_id}/cancel", response_model=AppointmentRead)
async def cancel_appointment(
    appt_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role(
        "receptionist", "hospital_admin", "super_admin",
    )),
):
    appt = await session.get(Appointment, appt_id)
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")
    if appt.status in ("cancelled", "completed"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel appointment with status '{appt.status}'",
        )
    appt.status = "cancelled"
    await session.commit()
    await session.refresh(appt)

    tenant = current_user.get("tenant_schema", "public")
    await ws_manager.broadcast(tenant, "appointment:update", {
        "event": "appointment_cancelled",
        "appointment_id": str(appt.id),
    })

    return await _enrich(appt, session)


# ── Check-in (→ Visit + QueueToken) ──────────────────────────────────────────

@router.post("/{appt_id}/checkin", response_model=CheckInResult)
async def checkin_appointment(
    appt_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role(
        "receptionist", "hospital_admin", "super_admin",
    )),
):
    appt = await session.get(Appointment, appt_id)
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")
    if appt.status not in _VALID_CHECK_IN_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Appointment status '{appt.status}' cannot be checked in (need scheduled/confirmed)",
        )

    # Check no duplicate open visit
    existing_visit = (await session.execute(
        select(Visit).where(
            and_(
                Visit.appointment_id == appt_id,
                Visit.status != "closed",
            )
        )
    )).scalar_one_or_none()
    if existing_visit:
        # Already checked in — return existing token
        existing_token = (await session.execute(
            select(QueueToken).where(QueueToken.appointment_id == appt_id)
        )).scalar_one_or_none()
        if existing_token:
            return CheckInResult(
                appointment_id=appt_id,
                visit_id=existing_visit.id,
                token_id=existing_token.id,
                token_no=existing_token.token_no,
                queue_type=existing_token.queue_type,
            )
        raise HTTPException(status_code=409, detail="Visit already opened for this appointment")

    # Determine priority based on patient age / flags (simple: always normal for now)
    patient = await session.get(Patient, appt.patient_id)
    priority = "normal"
    if patient and patient.dob:
        from datetime import date as _date
        age = (_date.today() - patient.dob).days // 365
        if age >= 60:
            priority = "senior_citizen"

    # Next token_no for consultation queue today
    from datetime import date as _date
    today_start = datetime.combine(_date.today(), time.min, tzinfo=timezone.utc)
    last_token = (await session.execute(
        select(QueueToken.token_no)
        .where(and_(
            QueueToken.queue_type == "consultation",
            QueueToken.issued_at >= today_start,
        ))
        .order_by(QueueToken.token_no.desc())
        .limit(1)
    )).scalar_one_or_none()
    token_no = (last_token or 0) + 1

    # Create Visit
    visit = Visit(
        id=uuid.uuid4(),
        patient_id=appt.patient_id,
        doctor_id=appt.doctor_id,
        appointment_id=appt_id,
        status="registered",
    )
    session.add(visit)

    # Create QueueToken
    token = QueueToken(
        id=uuid.uuid4(),
        patient_id=appt.patient_id,
        appointment_id=appt_id,
        token_no=token_no,
        queue_type="consultation",
        priority=priority,
        status="waiting",
        issued_at=datetime.now(timezone.utc),
    )
    session.add(token)

    # Mark appointment checked_in
    appt.status = "checked_in"

    await session.commit()
    await session.refresh(visit)
    await session.refresh(token)

    # Broadcast real-time updates
    tenant = current_user.get("tenant_schema", "public")
    await ws_manager.broadcast(tenant, "queue:update", {
        "event": "token_issued",
        "token_id": str(token.id),
        "token_no": token_no,
        "queue_type": "consultation",
        "priority": priority,
        "appointment_id": str(appt_id),
    })

    return CheckInResult(
        appointment_id=appt_id,
        visit_id=visit.id,
        token_id=token.id,
        token_no=token_no,
        queue_type="consultation",
    )
