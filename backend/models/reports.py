from core.database import Base
from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String


class Reports(Base):
    __tablename__ = "reports"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    user_id = Column(String, nullable=False)
    title = Column(String, nullable=False)
    description = Column(String, nullable=True)
    category = Column(String, nullable=False)
    priority = Column(String, nullable=False)
    status = Column(String, nullable=False)
    reporter_name = Column(String, nullable=True)
    reporter_phone = Column(String, nullable=True)
    reporter_role = Column(String, nullable=True)
    region = Column(String, nullable=True)
    mosque_name = Column(String, nullable=True)
    assigned_engineer = Column(String, nullable=True)
    assigned_engineer_name = Column(String, nullable=True)
    repair_type = Column(String, nullable=True)
    executing_entity = Column(String, nullable=True)
    estimated_cost = Column(Float, nullable=True, default=None)
    status_changed_by = Column(String, nullable=True)
    status_changed_by_name = Column(String, nullable=True)
    is_split = Column(Boolean, default=False, nullable=False)
    engineer_note = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=True)