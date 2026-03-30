import uuid
from typing import Optional

from pydantic import BaseModel


class DoctorRead(BaseModel):
    id: uuid.UUID
    full_name: str
    specialization: str
    department_id: Optional[uuid.UUID] = None
    consultation_fee: float
    qualification: Optional[str] = None
    experience_years: Optional[int] = None
    is_active: bool

    model_config = {"from_attributes": True}
