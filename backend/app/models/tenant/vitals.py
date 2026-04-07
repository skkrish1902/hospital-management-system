from typing import Optional
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Vitals(Base):
    __tablename__ = "vitals"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    visit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("visits.id"), nullable=False, index=True)
    uhid: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, index=True)
    bp_systolic: Mapped[Optional[int]] = mapped_column()
    bp_diastolic: Mapped[Optional[int]] = mapped_column()
    temperature: Mapped[Optional[float]] = mapped_column(Float)  # Celsius
    weight: Mapped[Optional[float]] = mapped_column(Float)       # kg
    height: Mapped[Optional[float]] = mapped_column(Float)       # cm
    spo2: Mapped[Optional[int]] = mapped_column()                # %
    pulse: Mapped[Optional[int]] = mapped_column()               # bpm
    recorded_by_user_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
