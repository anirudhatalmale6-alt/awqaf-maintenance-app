from core.database import Base
from sqlalchemy import Column, DateTime, Integer, String, UniqueConstraint


class AnnouncementSeen(Base):
    __tablename__ = "announcement_seen"
    __table_args__ = (
        UniqueConstraint("user_id", "announcement_id", name="uq_user_announcement"),
        {"extend_existing": True},
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    user_id = Column(String, nullable=False, index=True)
    announcement_id = Column(Integer, nullable=False, index=True)
    seen_at = Column(DateTime(timezone=True), nullable=True)