import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class VisitCreate(BaseModel):
    patient_id: uuid.UUID
    doctor_id: uuid.UUID
    appointment_id: Optional[uuid.UUID] = None


class VisitRead(BaseModel):
    id: uuid.UUID
    patient_id: uuid.UUID
    doctor_id: uuid.UUID
    appointment_id: Optional[uuid.UUID] = None
    status: str
    created_at: datetime
    closed_at: Optional[datetime] = None
    # Joined display fields
    patient_name: Optional[str] = None
    doctor_name: Optional[str] = None

    model_config = {"from_attributes": True}


class VisitStatusUpdate(BaseModel):
    status: str
    # registered | vitals_done | in_consultation | prescription_done | billing_pending | closed
