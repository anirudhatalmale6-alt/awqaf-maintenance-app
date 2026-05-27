from core.database import Base
from sqlalchemy import Column, DateTime, Integer, String


class Regions(Base):
    __tablename__ = "regions"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    name = Column(String, nullable=False, unique=True)
    created_at = Column(DateTime(timezone=True), nullable=True)