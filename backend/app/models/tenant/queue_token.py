from typing import Optional
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class QueueToken(Base):
    __tablename__ = "queue_tokens"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patients.id"), nullable=False, index=True)
    appointment_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("appointments.id"))
    token_no: Mapped[int] = mapped_column(Integer, nullable=False)
    queue_type: Mapped[str] = mapped_column(String(20), nullable=False)
    # queue_type: registration | vitals | consultation | pharmacy | billing
    priority: Mapped[str] = mapped_column(String(20), nullable=False, default="normal")
    # priority: emergency | senior_citizen | normal
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="waiting")
    # status: waiting | called | in_progress | completed | skipped
    issued_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    called_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
