from sqlalchemy import Column, Integer, String, DateTime, Float, Text, ForeignKey, JSON
from sqlalchemy.sql import func
from models.base import Base


class WorkOrders(Base):
    __tablename__ = "work_orders"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_number = Column(String, nullable=False, unique=True, index=True)
    contract_id = Column(Integer, ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False, index=True)
    mosque_id = Column(Integer, ForeignKey("mosques.id", ondelete="SET NULL"), nullable=True)
    mosque_name = Column(String, nullable=True)  # snapshot
    category = Column(String, nullable=True)  # legacy single category (kept for backwards compat)
    categories_breakdown = Column(JSON, nullable=True)  # list of {category, repair_type?, cost} items
    total_cost = Column(Float, nullable=False, default=0.0)
    order_date = Column(DateTime(timezone=True), nullable=True)
    repair_type = Column(String, nullable=True)
    assigned_engineers = Column(JSON, nullable=True)  # list of user ids or names
    status = Column(String, nullable=False, default="pending")  # pending, in_progress, completed, cancelled
    notes = Column(Text, nullable=True)
    # Licenses granted to this work order. Shape:
    # {
    #   "engineering_office": {"granted": bool, "note": str},
    #   "plans":              {"granted": bool},
    #   "electricity":        {"granted": bool},
    #   "fire_safety":        {"granted": bool},
    #   "regulation":         {"granted": bool},
    #   "municipality":       {"granted": bool},
    #   "note": "general licenses note"
    # }
    licenses = Column(JSON, nullable=True)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )