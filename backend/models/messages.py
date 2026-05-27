from core.database import Base
from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text


class Messages(Base):
    __tablename__ = "messages"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    sender_id = Column(String, nullable=False, index=True)
    receiver_id = Column(String, nullable=False, index=True)
    content = Column(Text, nullable=False)
    is_read = Column(Boolean, nullable=False, default=False, server_default='false')
    parent_id = Column(Integer, nullable=True)  # For replies
    created_at = Column(DateTime(timezone=True), nullable=True)