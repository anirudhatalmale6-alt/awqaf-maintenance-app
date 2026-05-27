"""Fiscal years model for tracking budget allocations per year.

Note: contract_id is optional — a fiscal year can be an independent record with
its own contract_number and contractor_name (free text, not tied to any stored
contract). When contract_id is provided, it may reference an existing contract.
"""
from sqlalchemy import Column, Integer, String, DateTime, Float, Text, ForeignKey
from sqlalchemy.sql import func
from models.base import Base


class FiscalYears(Base):
    __tablename__ = "fiscal_years"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, autoincrement=True)
    # Optional link to an existing contract (kept for backward compatibility).
    contract_id = Column(
        Integer,
        ForeignKey("contracts.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # Free-text snapshot fields so a fiscal year can be a standalone record.
    contract_number = Column(String, nullable=True)
    contractor_name = Column(String, nullable=True)
    year_label = Column(String, nullable=False)  # e.g. "2025/2026" or "2025"
    allocated_amount = Column(Float, nullable=False, default=0.0)
    spent_amount = Column(Float, nullable=False, default=0.0)
    # Lifecycle status of the fiscal year record. Mirrors common contract
    # states so admins can flag a year as active/completed/expired/cancelled.
    status = Column(String, nullable=False, default="active")
    start_date = Column(DateTime(timezone=True), nullable=True)
    end_date = Column(DateTime(timezone=True), nullable=True)
    notes = Column(Text, nullable=True)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )