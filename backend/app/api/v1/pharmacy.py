"""
Pharmacy Queue API — dispense prescribed medicines to patients.
"""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_role
from app.db.engine import get_session
from app.models.tenant.patient import Patient
from app.models.tenant.pharmacy_queue import PharmacyQueue
from app.models.tenant.prescription import Prescription
from app.models.tenant.visit import Visit
from app.schemas.pharmacy import PharmacyQueueRead, PharmacyStatusUpdate
from app.websocket.manager import ws_manager

router = APIRouter()


@router.get("", response_model=List[PharmacyQueueRead])
async def list_pharmacy_queue(
    status_filter: Optional[str] = Query(None, alias="status"),
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_role("pharmacist", "nurse", "receptionist", "hospital_admin", "super_admin")),
):
    """Returns pharmacy queue items, optionally filtered by status."""
    stmt = select(PharmacyQueue).order_by(PharmacyQueue.updated_at.asc())
    if status_filter:
        stmt = stmt.where(PharmacyQueue.status == status_filter)
    rows = (await session.execute(stmt)).scalars().all()

    items = []
    for pq in rows:
        item = PharmacyQueueRead.model_validate(pq)
        rx = await session.get(Prescription, pq.prescription_id)
        if rx:
            item.visit_id = rx.visit_id
            item.medicines = rx.medicines
            visit = await session.get(Visit, rx.visit_id)
            if visit:
                patient = await session.get(Patient, visit.patient_id)
                if patient:
                    item.patient_name = f"{patient.first_name} {patient.last_name}"
        items.append(item)
    return items


@router.patch("/{pq_id}/status", response_model=PharmacyQueueRead)
async def update_pharmacy_status(
    pq_id: uuid.UUID,
    payload: PharmacyStatusUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role("pharmacist", "nurse", "receptionist", "hospital_admin", "super_admin")),
):
    pq = await session.get(PharmacyQueue, pq_id)
    if not pq:
        raise HTTPException(status_code=404, detail="Pharmacy queue item not found")

    pq.status = payload.status
    if payload.notes is not None:
        pq.notes = payload.notes

    # When dispensed, move the visit to billing_pending
    if payload.status == "dispensed":
        rx = await session.get(Prescription, pq.prescription_id)
        if rx:
            visit = await session.get(Visit, rx.visit_id)
            if visit and visit.status == "dispatched_pharmacy":
                visit.status = "billing_pending"

    await session.commit()
    await session.refresh(pq)

    tenant = current_user.get("tenant_schema", "public")
    await ws_manager.broadcast(tenant, "pharmacy:update", {
        "event": "pharmacy_status_updated",
        "pq_id": str(pq.id),
        "status": pq.status,
    })

    item = PharmacyQueueRead.model_validate(pq)
    rx = await session.get(Prescription, pq.prescription_id)
    if rx:
        item.visit_id = rx.visit_id
        item.medicines = rx.medicines
        visit = await session.get(Visit, rx.visit_id)
        if visit:
            patient = await session.get(Patient, visit.patient_id)
            if patient:
                item.patient_name = f"{patient.first_name} {patient.last_name}"
    return item
