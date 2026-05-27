from core.database import Base
from sqlalchemy import Boolean, Column, DateTime, Integer, String


class Email_preferences(Base):
    __tablename__ = "email_preferences"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    user_id = Column(String, nullable=False)
    email_on_status_change = Column(Boolean, nullable=True)
    email_on_new_note = Column(Boolean, nullable=True)
    email_on_report_shared = Column(Boolean, nullable=True)
    email_on_report_assigned = Column(Boolean, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=True)