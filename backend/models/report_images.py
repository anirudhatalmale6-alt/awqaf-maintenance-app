from core.database import Base
from sqlalchemy import Column, DateTime, Integer, String


class Report_images(Base):
    __tablename__ = "report_images"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    user_id = Column(String, nullable=True)
    report_id = Column(Integer, nullable=False)
    object_key = Column(String, nullable=False)
    file_name = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=True)