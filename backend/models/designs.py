"""Designs/Plans model for tracking design documents linked to work orders (or contracts)."""
from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey
from sqlalchemy.sql import func
from models.base import Base


class Designs(Base):
    __tablename__ = "designs"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, autoincrement=True)
    # contract_id kept for backwards compatibility; new designs should primarily link to a work order
    contract_id = Column(Integer, ForeignKey("contracts.id", ondelete="CASCADE"), nullable=True, index=True)
    work_order_id = Column(Integer, ForeignKey("work_orders.id", ondelete="CASCADE"), nullable=True, index=True)
    mosque_id = Column(Integer, ForeignKey("mosques.id", ondelete="SET NULL"), nullable=True, index=True)
    mosque_name = Column(String, nullable=True)  # snapshot
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    design_number = Column(String, nullable=True)
    design_date = Column(DateTime(timezone=True), nullable=True)
    status = Column(String, nullable=False, default="draft")  # draft, approved, rejected
    file_url = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )