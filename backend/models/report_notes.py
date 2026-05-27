from core.database import Base
from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text


class Report_notes(Base):
    __tablename__ = "report_notes"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    report_id = Column(Integer, nullable=False, index=True)
    user_id = Column(String, nullable=False)
    user_name = Column(String, nullable=False)
    user_specialization = Column(String, nullable=True)
    content = Column(Text, nullable=False)
    parent_id = Column(Integer, nullable=True, index=True)
    is_edited = Column(Boolean, default=False, nullable=False)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)