from typing import Optional
import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Prescription(Base, TimestampMixin):
    __tablename__ = "prescriptions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    visit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("visits.id"), nullable=False, index=True)
    uhid: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, index=True)
    # e.g. [{"name": "Paracetamol", "dose": "500mg", "frequency": "TID", "duration": "5 days", "route": "oral"}]
    medicines: Mapped[Optional[list]] = mapped_column(JSONB)
    instructions: Mapped[Optional[str]] = mapped_column(Text)
