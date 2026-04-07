from typing import Optional
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class LabOrder(Base):
    __tablename__ = "lab_orders"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    visit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("visits.id"), nullable=False, index=True)
    uhid: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, index=True)
    # e.g. [{"test": "CBC", "notes": "fasting required"}]
    tests: Mapped[Optional[list]] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="ordered")
    # status: ordered | sample_collected | processing | resulted | rejected
    ordered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class LabResult(Base):
    __tablename__ = "lab_results"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    lab_order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lab_orders.id"), nullable=False, index=True)
    uhid: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, index=True)
    results: Mapped[Optional[dict]] = mapped_column(JSONB)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    critical_flags: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    # Relative path served under /uploads/lab/
    report_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reported_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column()
    reported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
