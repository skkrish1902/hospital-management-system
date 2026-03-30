import uuid
from datetime import date
from typing import Optional

from pydantic import BaseModel, EmailStr


class PatientCreate(BaseModel):
    first_name: str
    last_name: str
    dob: Optional[date] = None
    gender: str  # male | female | other
    phone: str
    email: Optional[EmailStr] = None
    address: Optional[str] = None
    blood_group: Optional[str] = None
    insurance_provider: Optional[str] = None
    insurance_id: Optional[str] = None


class PatientRead(BaseModel):
    id: uuid.UUID
    uhid: str
    first_name: str
    last_name: str
    dob: Optional[date] = None
    gender: str
    phone: str
    email: Optional[str] = None
    address: Optional[str] = None
    blood_group: Optional[str] = None
    insurance_provider: Optional[str] = None
    insurance_id: Optional[str] = None
    is_active: bool

    model_config = {"from_attributes": True}


class PatientUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    dob: Optional[date] = None
    gender: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    address: Optional[str] = None
    blood_group: Optional[str] = None
    insurance_provider: Optional[str] = None
    insurance_id: Optional[str] = None
