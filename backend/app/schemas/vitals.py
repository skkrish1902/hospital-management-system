import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class VitalsCreate(BaseModel):
    visit_id: uuid.UUID
    bp_systolic: Optional[int] = None
    bp_diastolic: Optional[int] = None
    temperature: Optional[float] = None   # Celsius
    weight: Optional[float] = None        # kg
    height: Optional[float] = None        # cm
    spo2: Optional[int] = None            # %
    pulse: Optional[int] = None           # bpm
    # bmi is computed server-side — not accepted from client


class VitalsRead(BaseModel):
    id: uuid.UUID
    visit_id: uuid.UUID
    bp_systolic: Optional[int] = None
    bp_diastolic: Optional[int] = None
    temperature: Optional[float] = None
    weight: Optional[float] = None
    height: Optional[float] = None
    spo2: Optional[int] = None
    pulse: Optional[int] = None
    bmi: Optional[float] = None
    recorded_by_user_id: uuid.UUID
    recorded_at: datetime

    model_config = {"from_attributes": True}
