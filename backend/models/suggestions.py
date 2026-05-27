"""Suggestions/inquiries table model."""
from sqlalchemy import Column, DateTime, String, Text, text
from sqlalchemy.sql import func

from models.base import Base


class Suggestion(Base):
    """Stores user/guest suggestions, inquiries, complaints, and notes."""

    __tablename__ = "suggestions"

    id = Column(String, primary_key=True, server_default=text("gen_random_uuid()::text"))
    # Type: suggestion | inquiry | complaint | note
    type = Column(String(32), nullable=False, default="suggestion")
    title = Column(String(300), nullable=False)
    content = Column(Text, nullable=False)

    # Submitter (guest) info — optional when submitted by a logged-in user
    sender_name = Column(String(200), nullable=True)
    sender_email = Column(String(200), nullable=True)

    # If submitted while authenticated, the user id is stored here
    user_id = Column(String, nullable=True, index=True)

    # Status: new | reviewing | replied | closed
    status = Column(String(32), nullable=False, default="new")
    admin_reply = Column(Text, nullable=True)
    replied_by = Column(String, nullable=True)  # admin user id who replied
    replied_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )