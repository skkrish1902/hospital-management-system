from typing import Optional
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Invoice(Base, TimestampMixin):
    __tablename__ = "invoices"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    visit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("visits.id"), nullable=False, index=True)
    # e.g. [{"description": "Consultation", "amount": 500.00}, {"description": "CBC Test", "amount": 300.00}]
    line_items: Mapped[Optional[list]] = mapped_column(JSONB)
    subtotal: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0.0)
    discount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0.0)
    tax: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0.0)
    total: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0.0)
    payment_method: Mapped[Optional[str]] = mapped_column(String(20))
    # payment_method: cash | upi | card | insurance
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    # status: draft | paid | cancelled
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
