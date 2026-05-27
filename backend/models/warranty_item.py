from sqlalchemy import Column, Integer, String, DateTime, Float, Text, Boolean, ForeignKey
from sqlalchemy.sql import func
from models.base import Base


class WarrantyItem(Base):
    """Represents a maintenance work item under contractor warranty.

    Each row tracks a deliverable (HVAC, pump, electrical work, etc.) executed by
    a contractor for a specific mosque, with a warranty period during which the
    contractor is responsible for fixing any defects free of charge.
    """

    __tablename__ = "warranty_items"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Core descriptive fields
    title = Column(String, nullable=False)  # e.g. "تكييف القاعة الرئيسية"
    description = Column(Text, nullable=True)
    category = Column(String, nullable=True)  # snapshot label of report_categories
    category_value = Column(String, nullable=True)  # value/key of report_categories

    # Location
    mosque_id = Column(Integer, ForeignKey("mosques.id", ondelete="SET NULL"), nullable=True)
    mosque_name = Column(String, nullable=True)  # denormalized snapshot
    region_id = Column(Integer, nullable=True)
    region_name = Column(String, nullable=True)

    # Contractor (executing party)
    contractor_id = Column(Integer, ForeignKey("contractors.id", ondelete="SET NULL"), nullable=True)
    contractor_label = Column(String, nullable=True)  # denormalized snapshot
    contractor_value = Column(String, nullable=True)

    # Warranty period
    start_date = Column(DateTime(timezone=True), nullable=False)
    duration_months = Column(Integer, nullable=False, default=12)
    end_date = Column(DateTime(timezone=True), nullable=False)

    # Optional financial info
    cost = Column(Float, nullable=True)

    # Status: 'active' (سارية), 'expired' (منتهية), 'claimed' (مُطالب بها), 'cancelled' (ملغاة)
    status = Column(String, nullable=False, default="active")

    # Source linking — auto-create from work order, contract or report
    source_type = Column(String, nullable=True)  # 'work_order' | 'contract' | 'report' | 'manual'
    source_id = Column(Integer, nullable=True)  # FK-like reference (no hard FK to keep flexibility)

    # Claim tracking — when defects appear during the warranty period
    claim_count = Column(Integer, nullable=False, default=0)
    last_claim_at = Column(DateTime(timezone=True), nullable=True)
    claim_notes = Column(Text, nullable=True)

    # Misc
    notes = Column(Text, nullable=True)
    is_archived = Column(Boolean, nullable=False, default=False)

    # Audit
    created_by = Column(String, nullable=True)
    created_by_name = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )