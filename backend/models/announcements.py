from core.database import Base
from sqlalchemy import Column, DateTime, Integer, String, Text


class Announcements(Base):
    __tablename__ = "announcements"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    admin_id = Column(String, nullable=False)
    admin_name = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=True)