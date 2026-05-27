from core.database import Base
from sqlalchemy import Column, DateTime, Integer, String, Text, Boolean


class GuestAnnouncements(Base):
    __tablename__ = "guest_announcements"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    admin_id = Column(String, nullable=False)
    admin_name = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=True)