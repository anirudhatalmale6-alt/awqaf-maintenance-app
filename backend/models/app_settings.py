from core.database import Base
from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func


class AppSettings(Base):
    """Global application settings (key/value) for runtime-toggleable features.

    NOTE: `value` uses TEXT (unlimited length) because some settings like
    `user_guide_content` store large JSON blobs that exceed 500 characters.
    """

    __tablename__ = "app_settings"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    key = Column(String(100), unique=True, index=True, nullable=False)
    value = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())