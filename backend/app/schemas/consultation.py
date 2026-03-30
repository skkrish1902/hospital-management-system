import uuid
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class ConsultationCreate(BaseModel):
    visit_id: uuid.UUID
    chief_complaint: Optional[str] = None
    history: Optional[str] = None
    examination: Optional[str] = None
    # e.g. [{"code": "J06.9", "description": "Acute upper respiratory infection"}]
    diagnosis_icd10: Optional[List[Dict[str, Any]]] = None
    notes: Optional[str] = None
    follow_up_date: Optional[date] = None


class ConsultationUpdate(BaseModel):
    chief_complaint: Optional[str] = None
    history: Optional[str] = None
    examination: Optional[str] = None
    diagnosis_icd10: Optional[List[Dict[str, Any]]] = None
    notes: Optional[str] = None
    follow_up_date: Optional[date] = None


class ConsultationRead(BaseModel):
    id: uuid.UUID
    visit_id: uuid.UUID
    chief_complaint: Optional[str] = None
    history: Optional[str] = None
    examination: Optional[str] = None
    diagnosis_icd10: Optional[List[Dict[str, Any]]] = None
    notes: Optional[str] = None
    follow_up_date: Optional[date] = None
    created_at: datetime

    model_config = {"from_attributes": True}
