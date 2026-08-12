"""
Consultations API — doctor SOAP notes + ICD-10 diagnosis.
Creates or updates a consultation record keyed 1:1 with visit_id.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_role
from app.db.engine import get_session
from app.models.tenant.consultation import Consultation
from app.models.tenant.patient import Patient
from app.models.tenant.visit import Visit
from app.schemas.consultation import ConsultationCreate, ConsultationRead, ConsultationUpdate
from app.websocket.manager import ws_manager

router = APIRouter()


@router.post("", response_model=ConsultationRead, status_code=status.HTTP_201_CREATED)
async def create_consultation(
    payload: ConsultationCreate,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role("doctor", "hospital_admin", "super_admin")),
):
    visit = await session.get(Visit, payload.visit_id)
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")

    # Upsert — each visit has at most one consultation
    existing = (await session.execute(
        select(Consultation).where(Consultation.visit_id == payload.visit_id)
    )).scalar_one_or_none()

    if existing:
        raise HTTPException(
            status_code=409,
            detail="Consultation already exists for this visit. Use PATCH to update.",
        )

    patient = await session.get(Patient, visit.patient_id)
    data = payload.model_dump()
    # Defensive normalization for diagnosis_icd10
    diag = data.get("diagnosis_icd10")
    if isinstance(diag, str):
        if diag.strip() in ("null", "", "[]"):
            data["diagnosis_icd10"] = None
        else:
            try:
                import json
                parsed = json.loads(diag)
                if isinstance(parsed, list):
                    data["diagnosis_icd10"] = parsed if parsed else None
            except Exception:
                data["diagnosis_icd10"] = None
    elif diag is not None and not isinstance(diag, list):
        data["diagnosis_icd10"] = [diag] if diag else None
    elif isinstance(diag, list) and len(diag) == 0:
        data["diagnosis_icd10"] = None
    
    consult = Consultation(id=uuid.uuid4(), uhid=patient.uhid if patient else None, **data)
    session.add(consult)

    # Advance visit status
    if visit.status == "vitals_done":
        visit.status = "in_consultation"

    await session.commit()
    await session.refresh(consult)
    return consult


@router.patch("/{visit_id}", response_model=ConsultationRead)
async def update_consultation(
    visit_id: uuid.UUID,
    payload: ConsultationUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role("doctor", "hospital_admin", "super_admin")),
):
    consult = (await session.execute(
        select(Consultation).where(Consultation.visit_id == visit_id)
    )).scalar_one_or_none()
    if not consult:
        raise HTTPException(status_code=404, detail="Consultation not found for this visit")

    data = payload.model_dump(exclude_unset=True)
    # Defensive normalization for diagnosis_icd10
    if "diagnosis_icd10" in data:
        diag = data["diagnosis_icd10"]
        if isinstance(diag, str):
            if diag.strip() in ("null", "", "[]"):
                data["diagnosis_icd10"] = None
            else:
                try:
                    import json
                    parsed = json.loads(diag)
                    if isinstance(parsed, list):
                        data["diagnosis_icd10"] = parsed if parsed else None
                except Exception:
                    data["diagnosis_icd10"] = None
        elif diag is not None and not isinstance(diag, list):
            data["diagnosis_icd10"] = [diag] if diag else None
        elif isinstance(diag, list) and len(diag) == 0:
            data["diagnosis_icd10"] = None
    
    for field, value in data.items():
        setattr(consult, field, value)

    await session.commit()
    await session.refresh(consult)
    return consult


@router.get("/{visit_id}", response_model=ConsultationRead)
async def get_consultation(
    visit_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_role("doctor", "nurse", "pharmacist", "hospital_admin", "super_admin")),
):
    consult = (await session.execute(
        select(Consultation).where(Consultation.visit_id == visit_id)
    )).scalar_one_or_none()
    if not consult:
        raise HTTPException(status_code=404, detail="No consultation found for this visit")
    return consult
