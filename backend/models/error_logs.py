from sqlalchemy import Column, Integer, String, DateTime, Text
from sqlalchemy.sql import func
from models.base import Base


class ErrorLogs(Base):
    __tablename__ = "error_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    request_id = Column(String, nullable=True, index=True)
    error_type = Column(String, nullable=False, index=True)  # dns, backend, network, etc.
    status_code = Column(Integer, nullable=True)
    message = Column(Text, nullable=False)
    url = Column(Text, nullable=True)
    method = Column(String, nullable=True)
    user_id = Column(String, nullable=True, index=True)
    user_email = Column(String, nullable=True)
    user_agent = Column(Text, nullable=True)
    raw_details = Column(Text, nullable=True)  # JSON stringified extra context
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)