"""
Lab Orders API — manage lab tests ordered by doctors and enter results.
"""
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, require_role
from app.db.engine import get_session
from app.models.tenant.doctor import Doctor
from app.models.tenant.lab_order import LabOrder, LabResult
from app.models.tenant.patient import Patient
from app.models.tenant.visit import Visit
from app.schemas.lab import LabOrderCreate, LabOrderRead, LabResultCreate, LabResultRead
from app.websocket.manager import ws_manager

router = APIRouter()


@router.post("", response_model=LabOrderRead, status_code=status.HTTP_201_CREATED)
async def create_lab_order(
    payload: LabOrderCreate,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role("doctor", "hospital_admin", "super_admin")),
):
    """Doctor creates a lab order for a visit."""
    visit = await session.get(Visit, payload.visit_id)
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")

    order = LabOrder(
        id=uuid.uuid4(),
        visit_id=payload.visit_id,
        tests=[t.model_dump() for t in payload.tests],
        status="ordered",
    )
    session.add(order)
    await session.commit()
    await session.refresh(order)

    tenant = current_user.get("tenant_schema", "public")
    await ws_manager.broadcast(tenant, "lab:update", {
        "event": "lab_order_created",
        "order_id": str(order.id),
        "visit_id": str(order.visit_id),
    })

    return await _enrich_order(order, session)


@router.get("", response_model=List[LabOrderRead])
async def list_lab_orders(
    status_filter: Optional[str] = Query(None, alias="status"),
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_role("nurse", "doctor", "receptionist", "hospital_admin", "super_admin")),
):
    stmt = select(LabOrder).order_by(LabOrder.ordered_at.asc())
    if status_filter:
        stmt = stmt.where(LabOrder.status == status_filter)
    rows = (await session.execute(stmt)).scalars().all()
    return [await _enrich_order(o, session) for o in rows]


@router.patch("/{order_id}/status", response_model=LabOrderRead)
async def update_lab_order_status(
    order_id: uuid.UUID,
    new_status: str,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role("nurse", "doctor", "hospital_admin", "super_admin")),
):
    """Advance lab order status: ordered → sample_collected → processing → resulted."""
    order = await session.get(LabOrder, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Lab order not found")
    order.status = new_status
    await session.commit()
    await session.refresh(order)

    tenant = current_user.get("tenant_schema", "public")
    await ws_manager.broadcast(tenant, "lab:update", {
        "event": "lab_order_status",
        "order_id": str(order.id),
        "status": order.status,
    })
    return await _enrich_order(order, session)


@router.post("/{order_id}/results", response_model=LabResultRead, status_code=status.HTTP_201_CREATED)
async def enter_lab_results(
    order_id: uuid.UUID,
    payload: LabResultCreate,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role("nurse", "doctor", "hospital_admin", "super_admin")),
):
    """Enter results for a lab order — advances order to 'resulted'."""
    order = await session.get(LabOrder, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Lab order not found")

    result = LabResult(
        id=uuid.uuid4(),
        lab_order_id=order_id,
        results=payload.results,
        reported_by_user_id=uuid.UUID(current_user["sub"]),
    )
    session.add(result)
    order.status = "resulted"
    await session.commit()
    await session.refresh(result)

    tenant = current_user.get("tenant_schema", "public")
    await ws_manager.broadcast(tenant, "lab:update", {
        "event": "lab_results_entered",
        "order_id": str(order_id),
        "visit_id": str(order.visit_id),
    })
    return result


@router.get("/{order_id}/results", response_model=LabResultRead)
async def get_lab_results(
    order_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_role("nurse", "doctor", "receptionist", "hospital_admin", "super_admin")),
):
    result = (await session.execute(
        select(LabResult).where(LabResult.lab_order_id == order_id)
    )).scalar_one_or_none()
    if not result:
        raise HTTPException(status_code=404, detail="No results yet for this lab order")
    return result


async def _enrich_order(order: LabOrder, session) -> LabOrderRead:
    item = LabOrderRead.model_validate(order)
    visit = await session.get(Visit, order.visit_id)
    if visit:
        patient = await session.get(Patient, visit.patient_id)
        doctor = await session.get(Doctor, visit.doctor_id)
        if patient:
            item.patient_name = f"{patient.first_name} {patient.last_name}"
        if doctor:
            item.doctor_name = doctor.full_name
    return item
