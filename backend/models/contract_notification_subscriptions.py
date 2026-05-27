"""Model for users subscribed to contract/work-order notifications."""
from sqlalchemy import Column, DateTime, String, text
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import UUID

from core.database import Base


class ContractNotificationSubscription(Base):
    __tablename__ = "contract_notification_subscriptions"
    __table_args__ = {"extend_existing": True}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"), nullable=False)
    user_id = Column(String, nullable=False, unique=True, index=True)
    created_at = Column(DateTime(timezone=True), nullable=True, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=True, server_default=func.now())