from core.database import Base
from sqlalchemy import Column, DateTime, Integer, String, UniqueConstraint


class Report_notification_subscriptions(Base):
    __tablename__ = "report_notification_subscriptions"
    __table_args__ = (
        UniqueConstraint("user_id", "report_id", name="uq_user_report_subscription"),
        {"extend_existing": True},
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    user_id = Column(String, nullable=False)
    report_id = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=True)