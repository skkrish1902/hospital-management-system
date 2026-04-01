"""
Billing API — invoice creation, line-item management, and payment processing.
"""
import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_role
from app.db.engine import get_session
from app.models.tenant.invoice import Invoice
from app.models.tenant.visit import Visit
from app.schemas.invoice import InvoiceCreate, InvoicePayment, InvoiceRead
from app.websocket.manager import ws_manager

router = APIRouter()


@router.get("", response_model=List[InvoiceRead])
async def list_invoices(
    visit_id: uuid.UUID | None = None,
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_role("receptionist", "billing_officer", "hospital_admin", "super_admin")),
):
    stmt = select(Invoice).order_by(Invoice.created_at.desc())
    if visit_id:
        stmt = stmt.where(Invoice.visit_id == visit_id)
    rows = (await session.execute(stmt)).scalars().all()
    return rows


def _compute_totals(line_items: list | None, discount: float, tax: float) -> float:
    subtotal = sum(item.get("amount", 0) for item in (line_items or []))
    total = subtotal - discount + tax
    return subtotal, max(total, 0.0)


@router.post("", response_model=InvoiceRead, status_code=status.HTTP_201_CREATED)
async def create_invoice(
    payload: InvoiceCreate,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role("receptionist", "billing_officer", "hospital_admin", "super_admin")),
):
    visit = await session.get(Visit, payload.visit_id)
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")

    # Check for duplicate draft invoice
    existing = (await session.execute(
        select(Invoice).where(Invoice.visit_id == payload.visit_id, Invoice.status == "draft")
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="A draft invoice already exists for this visit")

    li_dicts = [item.model_dump() for item in (payload.line_items or [])]
    subtotal, total = _compute_totals(li_dicts, payload.discount, payload.tax)

    invoice = Invoice(
        id=uuid.uuid4(),
        visit_id=payload.visit_id,
        line_items=li_dicts,
        subtotal=subtotal,
        discount=payload.discount,
        tax=payload.tax,
        total=total,
        status="draft",
    )
    session.add(invoice)

    # Move visit to billing_pending
    if visit.status == "prescription_done":
        visit.status = "billing_pending"

    await session.commit()
    await session.refresh(invoice)
    return invoice


@router.get("/visit/{visit_id}", response_model=InvoiceRead)
async def get_invoice_by_visit(
    visit_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_role("receptionist", "billing_officer", "doctor", "hospital_admin", "super_admin")),
):
    invoice = (await session.execute(
        select(Invoice).where(Invoice.visit_id == visit_id)
    )).scalar_one_or_none()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found for this visit")
    return invoice


@router.post("/{invoice_id}/pay", response_model=InvoiceRead)
async def pay_invoice(
    invoice_id: uuid.UUID,
    payload: InvoicePayment,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role("receptionist", "billing_officer", "hospital_admin", "super_admin")),
):
    invoice = await session.get(Invoice, invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.status != "draft":
        raise HTTPException(status_code=400, detail=f"Invoice already {invoice.status}")

    invoice.payment_method = payload.payment_method
    invoice.status = "paid"
    invoice.paid_at = datetime.now(timezone.utc)

    # Transition visit based on billing type:
    # pre_billing (upfront at reception) → registered (now visible to nurse)
    # billing_pending (end of OPD after doctor) → closed
    visit = await session.get(Visit, invoice.visit_id)
    if visit:
        if visit.status == "pre_billing":
            visit.status = "registered"
        elif visit.status == "billing_pending":
            visit.status = "closed"
            visit.closed_at = datetime.now(timezone.utc)

    await session.commit()
    await session.refresh(invoice)

    # Notify → feedback trigger (Phase 4)
    tenant = current_user.get("tenant_schema", "public")
    await ws_manager.broadcast(tenant, "visit:update", {
        "event": "invoice_paid",
        "invoice_id": str(invoice.id),
        "visit_id": str(invoice.visit_id),
    })

    return invoice
