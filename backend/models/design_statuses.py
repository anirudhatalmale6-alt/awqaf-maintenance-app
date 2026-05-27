from sqlalchemy import Column, Integer, String, DateTime, Boolean
from sqlalchemy.sql import func
from models.base import Base


class Design_statuses(Base):
    __tablename__ = "design_statuses"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, autoincrement=True)
    value = Column(String, nullable=False, unique=True)
    label = Column(String, nullable=False)
    color = Column(String, nullable=False, default="bg-gray-100 text-gray-800")
    sort_order = Column(Integer, nullable=False, default=0)
    is_default = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())