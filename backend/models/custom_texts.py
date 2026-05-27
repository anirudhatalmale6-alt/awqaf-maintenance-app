from core.database import Base
from sqlalchemy import Column, DateTime, Integer, String


class Custom_texts(Base):
    __tablename__ = "custom_texts"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    text_key = Column(String, nullable=False)
    text_value = Column(String, nullable=False)
    updated_by = Column(String, nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=True)