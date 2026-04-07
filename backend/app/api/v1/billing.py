"""
Billing API — invoice creation, line-item management, and payment processing.
"""
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_role
from app.core.razorpay_service import create_razorpay_order, fetch_order_payments, verify_webhook_signature
from app.db.engine import AsyncSessionLocal, get_session, tenant_schema_var
from app.models.tenant.invoice import Invoice
from app.models.tenant.patient import Patient
from app.models.tenant.visit import Visit
from app.schemas.invoice import InvoiceCreate, InvoicePayment, InvoiceRead
from app.websocket.manager import ws_manager

logger = logging.getLogger(__name__)

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

    patient = await session.get(Patient, visit.patient_id)
    li_dicts = [item.model_dump() for item in (payload.line_items or [])]
    subtotal, total = _compute_totals(li_dicts, payload.discount, payload.tax)

    invoice = Invoice(
        id=uuid.uuid4(),
        visit_id=payload.visit_id,
        uhid=patient.uhid if patient else None,
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
    _: dict = Depends(require_role("receptionist", "billing_officer", "nurse", "doctor", "hospital_admin", "super_admin")),
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


@router.post("/{invoice_id}/sync-payment", response_model=InvoiceRead)
async def sync_razorpay_payment(
    invoice_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role("receptionist", "billing_officer", "nurse", "hospital_admin", "super_admin")),
):
    """
    Fallback for missed webhooks (ngrok down, stale URL, etc.).
    Calls the Razorpay API directly to check if the order was paid,
    and updates the invoice + visit if so.
    """
    invoice = await session.get(Invoice, invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.status == "paid":
        # Invoice already paid — but visit might be stuck in pre_billing due to a
        # partial webhook failure. Check and repair without re-processing payment.
        visit = await session.get(Visit, invoice.visit_id)
        if visit and visit.status == "pre_billing":
            visit.status = "registered"
            await session.commit()
        elif visit and visit.status == "billing_pending":
            visit.status = "closed"
            visit.closed_at = datetime.now(timezone.utc)
            await session.commit()
        return invoice
    if not invoice.razorpay_order_id:
        raise HTTPException(status_code=400, detail="No Razorpay order linked to this invoice")

    payment = fetch_order_payments(invoice.razorpay_order_id)
    if not payment:
        raise HTTPException(status_code=402, detail="No captured payment found on Razorpay for this order")

    invoice.razorpay_payment_id = payment.get("id")
    invoice.payment_method = payment.get("method", "razorpay")
    invoice.status = "paid"
    invoice.paid_at = datetime.now(timezone.utc)

    visit = await session.get(Visit, invoice.visit_id)
    if visit and visit.status == "pre_billing":
        visit.status = "registered"
    elif visit and visit.status == "billing_pending":
        visit.status = "closed"
        visit.closed_at = datetime.now(timezone.utc)

    await session.commit()
    await session.refresh(invoice)

    tenant = current_user.get("tenant_schema", "public")
    await ws_manager.broadcast(tenant, "pos:payment", {
        "event": "payment_success",
        "razorpay_order_id": invoice.razorpay_order_id,
        "razorpay_payment_id": invoice.razorpay_payment_id,
        "payment_method": invoice.payment_method,
    })
    logger.info("Payment synced manually: invoice=%s order=%s", invoice_id, invoice.razorpay_order_id)
    return invoice


@router.post("/{invoice_id}/resend-pos", response_model=InvoiceRead)
async def resend_pos_request(
    invoice_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role("receptionist", "nurse", "hospital_admin", "super_admin")),
):
    """
    Re-broadcast the Razorpay POS payment request to the kiosk screen.
    Used when the POS screen was missed or timed out.
    """
    invoice = await session.get(Invoice, invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.status == "paid":
        raise HTTPException(status_code=400, detail="Invoice already paid")
    if not invoice.razorpay_order_id:
        raise HTTPException(status_code=400, detail="No Razorpay order linked to this invoice")

    visit = await session.get(Visit, invoice.visit_id)
    patient = await session.get(Patient, visit.patient_id) if visit else None

    tenant = current_user.get("tenant_schema", "public")
    await ws_manager.broadcast(tenant, "pos:payment", {
        "event": "payment_request",
        "razorpay_key_id": __import__("app.core.config", fromlist=["settings"]).settings.RAZORPAY_KEY_ID,
        "razorpay_order_id": invoice.razorpay_order_id,
        "invoice_id": str(invoice.id),
        "amount": int(float(invoice.total) * 100),
        "amount_display": f"\u20b9{float(invoice.total):.0f}",
        "patient_name": f"{patient.first_name} {patient.last_name}" if patient else "Patient",
        "uhid": invoice.uhid or "",
        "description": invoice.line_items[0]["description"] if invoice.line_items else "Consultation Fee",
    })
    logger.info("POS payment request re-sent: invoice=%s", invoice_id)
    return invoice


@router.post("/{invoice_id}/admit-patient", response_model=InvoiceRead)
async def admit_patient_manually(
    invoice_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role("receptionist", "nurse", "hospital_admin", "super_admin")),
):
    """
    Nurse manually marks an invoice as paid (cash collected at desk)
    and advances the visit from pre_billing → registered so it appears
    in the nurse vitals queue.
    """
    invoice = await session.get(Invoice, invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.status == "paid":
        # Already paid — just repair the visit if stuck
        visit = await session.get(Visit, invoice.visit_id)
        if visit and visit.status == "pre_billing":
            visit.status = "registered"
            await session.commit()
        return invoice

    invoice.payment_method = "cash"
    invoice.status = "paid"
    invoice.paid_at = datetime.now(timezone.utc)

    visit = await session.get(Visit, invoice.visit_id)
    if visit and visit.status == "pre_billing":
        visit.status = "registered"

    await session.commit()
    await session.refresh(invoice)

    tenant = current_user.get("tenant_schema", "public")
    await ws_manager.broadcast(tenant, "visit:update", {
        "event": "invoice_paid",
        "invoice_id": str(invoice.id),
        "visit_id": str(invoice.visit_id),
    })
    logger.info("Patient manually admitted by nurse: invoice=%s", invoice_id)
    return invoice


@router.post("/razorpay/webhook", include_in_schema=True, status_code=200)
async def razorpay_webhook(request: Request):
    """
    Razorpay webhook receiver.
    Handles `payment.captured` events to mark invoices paid and advance the visit.

    The tenant schema is embedded in the Razorpay order notes at order creation time
    (key: 'tenant_schema'), so this endpoint works for all tenants without JWT.
    """
    body = await request.body()
    signature = request.headers.get("X-Razorpay-Signature", "")

    if not verify_webhook_signature(body, signature):
        logger.warning("Razorpay webhook: invalid signature")
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    try:
        event_data = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    # Handle both captured (live/auto-capture) and authorized (test mode default)
    if event_data.get("event") not in ("payment.captured", "payment.authorized"):
        return {"status": "ignored"}

    payment_entity = event_data.get("payload", {}).get("payment", {}).get("entity", {})
    order_id = payment_entity.get("order_id")
    payment_id = payment_entity.get("id")
    payment_method = payment_entity.get("method")  # upi / card / netbanking
    notes = payment_entity.get("notes") or {}
    tenant_schema = notes.get("tenant_schema", "")

    if not order_id or not tenant_schema or not tenant_schema.replace("_", "").isalnum():
        logger.warning(
            "Razorpay webhook: missing order_id or tenant_schema. order_id=%s tenant=%s",
            order_id, tenant_schema,
        )
        return {"status": "ok"}  # acknowledge so Razorpay stops retrying

    # Manually acquire a session scoped to the correct tenant schema
    ctx_token = tenant_schema_var.set(tenant_schema)
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text(f'SET search_path TO "{tenant_schema}", public'))

            invoice = (await session.execute(
                select(Invoice).where(Invoice.razorpay_order_id == order_id)
            )).scalar_one_or_none()

            if not invoice or invoice.status == "paid":
                return {"status": "ok"}  # already processed or not found

            invoice.razorpay_payment_id = payment_id
            invoice.payment_method = payment_method
            invoice.status = "paid"
            invoice.paid_at = datetime.now(timezone.utc)

            visit = await session.get(Visit, invoice.visit_id)
            if visit and visit.status == "pre_billing":
                visit.status = "registered"
            elif visit and visit.status == "billing_pending":
                visit.status = "closed"
                visit.closed_at = datetime.now(timezone.utc)

            await session.commit()

        # Notify POS screen of payment success
        await ws_manager.broadcast(tenant_schema, "pos:payment", {
            "event": "payment_success",
            "razorpay_order_id": order_id,
            "razorpay_payment_id": payment_id,
            "payment_method": payment_method,
        })
        # Notify queue listeners (visit moved to registered)
        await ws_manager.broadcast(tenant_schema, "queue:update", {
            "event": "visit_registered",
        })

        logger.info(
            "Razorpay payment captured: order=%s payment=%s tenant=%s",
            order_id, payment_id, tenant_schema,
        )
    finally:
        tenant_schema_var.reset(ctx_token)

    return {"status": "ok"}
