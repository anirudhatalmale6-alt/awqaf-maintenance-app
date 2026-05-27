from core.database import Base
from sqlalchemy import Column, DateTime, Integer, String, ForeignKey


class Mosques(Base):
    __tablename__ = "mosques"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    name = Column(String, nullable=False)
    region_id = Column(Integer, ForeignKey("regions.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=True)