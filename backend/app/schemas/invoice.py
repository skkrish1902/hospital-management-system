import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class LineItem(BaseModel):
    description: str
    amount: float


class InvoiceCreate(BaseModel):
    visit_id: uuid.UUID
    line_items: Optional[List[LineItem]] = None
    discount: float = 0.0
    tax: float = 0.0


class InvoicePayment(BaseModel):
    payment_method: str  # cash | upi | card | insurance


class InvoiceRead(BaseModel):
    id: uuid.UUID
    visit_id: uuid.UUID
    line_items: Optional[List[Dict[str, Any]]] = None
    subtotal: float
    discount: float
    tax: float
    total: float
    payment_method: Optional[str] = None
    status: str
    paid_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}
