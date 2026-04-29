import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class MedicineItem(BaseModel):
    name: str
    dose: str
    frequency: str   # OD | BD | TID | QID | SOS | etc.
    food_instruction: str = "N/A"  # Before Food | After Food | With Food | N/A
    duration: str    # "5 days", "1 week"
    route: str = "oral"
    notes: Optional[str] = None


class LabTestItem(BaseModel):
    test_name: str
    notes: Optional[str] = None


class PrescriptionCreate(BaseModel):
    visit_id: uuid.UUID
    medicines: Optional[List[MedicineItem]] = None
    instructions: Optional[str] = None
    lab_tests: Optional[List[LabTestItem]] = None  # doctor can include lab tests with prescription


class PrescriptionUpdate(BaseModel):
    medicines: Optional[List[MedicineItem]] = None
    instructions: Optional[str] = None
    lab_tests: Optional[List[LabTestItem]] = None


class PrescriptionRead(BaseModel):
    id: uuid.UUID
    visit_id: uuid.UUID
    medicines: Optional[List[Dict[str, Any]]] = None
    instructions: Optional[str] = None
    lab_tests: Optional[List[Dict[str, Any]]] = None
    created_at: datetime

    model_config = {"from_attributes": True}
