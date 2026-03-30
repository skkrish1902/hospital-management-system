import uuid
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class DoctorCreate(BaseModel):
    user_id: uuid.UUID
    full_name: str = Field(..., min_length=1, max_length=255)
    specialization: str = Field(..., min_length=1, max_length=255)
    department_id: Optional[uuid.UUID] = None
    consultation_fee: float = Field(default=0.0, ge=0)
    qualification: Optional[str] = Field(None, max_length=500)
    experience_years: Optional[int] = Field(None, ge=0, le=60)


class DoctorUpdate(BaseModel):
    full_name: Optional[str] = Field(None, min_length=1, max_length=255)
    specialization: Optional[str] = Field(None, min_length=1, max_length=255)
    department_id: Optional[uuid.UUID] = None
    consultation_fee: Optional[float] = Field(None, ge=0)
    qualification: Optional[str] = Field(None, max_length=500)
    experience_years: Optional[int] = Field(None, ge=0, le=60)
    is_active: Optional[bool] = None


class DoctorRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    full_name: str
    specialization: str
    department_id: Optional[uuid.UUID] = None
    department_name: Optional[str] = None  # populated by API layer
    consultation_fee: float
    qualification: Optional[str] = None
    experience_years: Optional[int] = None
    is_active: bool

    model_config = {"from_attributes": True}


class DoctorOnboard(BaseModel):
    """Creates a new login account (role=doctor) + doctor profile in one step."""
    # Login account fields
    email: EmailStr
    password: str = Field(..., min_length=8, description="Min 8 characters")
    # Doctor profile fields (full_name used for both account and profile)
    full_name: str = Field(..., min_length=1, max_length=255)
    specialization: str = Field(..., min_length=1, max_length=255)
    department_id: Optional[uuid.UUID] = None
    consultation_fee: float = Field(default=0.0, ge=0)
    qualification: Optional[str] = Field(None, max_length=500)
    experience_years: Optional[int] = Field(None, ge=0, le=60)
