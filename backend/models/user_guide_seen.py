"""Track when each user last viewed the User Guide page.

Used to decide whether to show a "new changelog" red dot next to the
guide link in the header. Stored as a tiny key/value (one row per user)
to avoid a full migration: if the guide content's latest changelog
`date` is newer than `last_seen_date`, the UI shows the badge.
"""
from sqlalchemy import Column, DateTime, String
from sqlalchemy.sql import func

from models.base import Base


class UserGuideSeen(Base):
    """One row per user storing the last time they opened the User Guide."""

    __tablename__ = "user_guide_seen"
    __table_args__ = {"extend_existing": True}

    # Matches users.id (platform sub, String).
    user_id = Column(String(255), primary_key=True, index=True)
    # ISO date (YYYY-MM-DD) of the most recent changelog entry the user has seen.
    # Stored as a short string to keep comparison identical to the
    # frontend's changelog.date format (no timezone ambiguity).
    last_seen_changelog_date = Column(String(20), nullable=True)
    last_seen_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )