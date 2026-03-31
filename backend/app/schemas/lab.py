import uuid
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class LabTestItem(BaseModel):
    test: str
    notes: Optional[str] = None


class LabOrderCreate(BaseModel):
    visit_id: uuid.UUID
    tests: List[LabTestItem]


class LabOrderRead(BaseModel):
    id: uuid.UUID
    visit_id: uuid.UUID
    tests: Optional[list] = None
    status: str
    ordered_at: datetime
    # Joined
    patient_name: Optional[str] = None
    doctor_name: Optional[str] = None

    model_config = {"from_attributes": True}


class LabResultCreate(BaseModel):
    results: dict  # free-form JSON: {"CBC": "Normal", "HbA1c": "5.6%", ...}


class LabResultRead(BaseModel):
    id: uuid.UUID
    lab_order_id: uuid.UUID
    results: Optional[dict] = None
    reported_by_user_id: Optional[uuid.UUID] = None
    reported_at: datetime

    model_config = {"from_attributes": True}
