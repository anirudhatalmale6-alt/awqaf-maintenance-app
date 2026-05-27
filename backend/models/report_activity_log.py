from core.database import Base
from sqlalchemy import Column, DateTime, Integer, String


class Report_activity_log(Base):
    __tablename__ = "report_activity_log"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    report_id = Column(Integer, nullable=False)
    user_id = Column(String, nullable=True)
    user_name = Column(String, nullable=True)
    action_type = Column(String, nullable=False)
    description = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=True)