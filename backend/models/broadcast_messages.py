from core.database import Base
from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func


class BroadcastMessages(Base):
    """Broadcast/group messages sent to multiple recipients."""
    __tablename__ = "broadcast_messages"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    sender_id = Column(String, nullable=False, index=True)
    subject = Column(String(500), nullable=False)
    content = Column(Text, nullable=False)
    # target_type: "all" | "role" | "users"
    target_type = Column(String(50), nullable=False)
    # For role-based: comma-separated role values e.g. "admin,monitor"
    # For users-based: comma-separated user IDs
    # For all: empty or null
    target_value = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class BroadcastReceipts(Base):
    """Tracks read status per recipient for broadcast messages."""
    __tablename__ = "broadcast_receipts"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    broadcast_id = Column(Integer, nullable=False, index=True)
    user_id = Column(String, nullable=False, index=True)
    is_read = Column(Boolean, nullable=False, default=False, server_default='false')
    read_at = Column(DateTime(timezone=True), nullable=True)