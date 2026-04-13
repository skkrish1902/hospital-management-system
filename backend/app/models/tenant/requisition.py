import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Requisition(Base, TimestampMixin):
    __tablename__ = "indents"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)

    # Auto-incrementing human-readable sequence number (per tenant schema)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)

    # Indent number: IND-YYYYMMDD-NNNN
    indent_number: Mapped[str] = mapped_column(String(30), unique=True, nullable=False, index=True)

    # Who raised it
    requested_by_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    requested_by_name: Mapped[str] = mapped_column(String(255), nullable=False)

    # From / To
    from_location: Mapped[str] = mapped_column(String(255), nullable=False)   # Department or Room number
    to_location: Mapped[str] = mapped_column(String(100), nullable=False)      # "Pharmacy" | "General Store"

    # Dates
    request_date: Mapped[date] = mapped_column(Date, nullable=False)
    need_by_date: Mapped[date] = mapped_column(Date, nullable=False)

    # Items (free-text)
    items: Mapped[str] = mapped_column(Text, nullable=False)

    # Status: pending | approved | rejected | fulfilled
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="pending")
