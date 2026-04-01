import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel


class VisitCreate(BaseModel):
    patient_id: uuid.UUID
    doctor_id: Optional[uuid.UUID] = None
    appointment_id: Optional[uuid.UUID] = None
    department_id: Optional[uuid.UUID] = None


class VisitRead(BaseModel):
    id: uuid.UUID
    patient_id: uuid.UUID
    doctor_id: Optional[uuid.UUID] = None
    appointment_id: Optional[uuid.UUID] = None
    department_id: Optional[uuid.UUID] = None
    status: str
    created_at: datetime
    closed_at: Optional[datetime] = None
    # Joined display fields
    patient_name: Optional[str] = None
    doctor_name: Optional[str] = None
    department_name: Optional[str] = None
    doctor_consultation_fee: Optional[float] = None  # pre-filled on billing page

    model_config = {"from_attributes": True}


class VisitStatusUpdate(BaseModel):
    status: str
    # registered | vitals_done | in_consultation | prescription_done | dispatched_pharmacy | dispatched_lab | billing_pending | closed


class VisitDispatch(BaseModel):
    """Nurse dispatch action after prescription_done."""
    action: Literal["billing", "pharmacy", "lab"]
    # billing   = patient leaves, no hospital pharmacy/lab needed → visit → billing_pending
    # pharmacy  = send to hospital pharmacy → creates PharmacyQueue + visit → billing_pending
    # lab       = send to lab → creates LabOrder activation + visit → closed (patient comes back)
