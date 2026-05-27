from core.database import Base
from sqlalchemy import Boolean, Column, DateTime, Integer, String


class Email_settings(Base):
    __tablename__ = "email_settings"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    smtp_host = Column(String, nullable=True)
    smtp_port = Column(Integer, nullable=True)
    smtp_username = Column(String, nullable=True)
    smtp_password = Column(String, nullable=True)
    sender_email = Column(String, nullable=True)
    sender_name = Column(String, nullable=True)
    use_tls = Column(Boolean, nullable=True)
    is_enabled = Column(Boolean, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=True)