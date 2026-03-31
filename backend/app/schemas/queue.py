import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class QueueTokenCreate(BaseModel):
    patient_id: uuid.UUID
    appointment_id: Optional[uuid.UUID] = None
    department_id: Optional[uuid.UUID] = None
    queue_type: str = "registration"   # registration | vitals | consultation | pharmacy | billing
    priority: str = "normal"           # emergency | senior_citizen | normal


class QueueTokenRead(BaseModel):
    id: uuid.UUID
    patient_id: uuid.UUID
    appointment_id: Optional[uuid.UUID] = None
    department_id: Optional[uuid.UUID] = None
    token_no: int
    queue_type: str
    priority: str
    status: str
    issued_at: datetime
    called_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    # Joined fields (populated in query)
    patient_name: Optional[str] = None
    patient_phone: Optional[str] = None
    department_name: Optional[str] = None

    model_config = {"from_attributes": True}


class QueueTokenStatusUpdate(BaseModel):
    status: str  # waiting | called | in_progress | completed | skipped
