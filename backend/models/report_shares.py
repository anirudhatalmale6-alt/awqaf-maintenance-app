from core.database import Base
from sqlalchemy import Column, DateTime, Integer, String


class Report_shares(Base):
    __tablename__ = "report_shares"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    user_id = Column(String, nullable=False)
    report_id = Column(Integer, nullable=False)
    recipient_id = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=True)