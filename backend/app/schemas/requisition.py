import uuid
from datetime import date, datetime

from pydantic import BaseModel


class RequisitionCreate(BaseModel):
    from_location: str
    to_location: str          # "Pharmacy" | "General Store"
    need_by_date: date
    items: str


class RequisitionRead(BaseModel):
    id: uuid.UUID
    seq: int
    indent_number: str
    requested_by_id: uuid.UUID
    requested_by_name: str
    from_location: str
    to_location: str
    request_date: date
    need_by_date: date
    items: str
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class RequisitionStatusUpdate(BaseModel):
    status: str   # pending | approved | rejected | fulfilled
