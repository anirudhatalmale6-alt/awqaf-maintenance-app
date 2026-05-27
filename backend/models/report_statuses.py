from sqlalchemy import Column, Integer, String, DateTime, Boolean
from sqlalchemy.sql import func
from models.base import Base


class Report_statuses(Base):
    __tablename__ = "report_statuses"

    id = Column(Integer, primary_key=True, autoincrement=True)
    value = Column(String, nullable=False, unique=True)
    label = Column(String, nullable=False)
    color = Column(String, nullable=False, default="bg-gray-100 text-gray-800")
    icon = Column(String, nullable=True, default=None)
    show_cost_input = Column(Boolean, nullable=False, default=False)
    sort_order = Column(Integer, nullable=False, default=0)
    is_default = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())