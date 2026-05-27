from core.database import Base
from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, Text


class Report_splits(Base):
    """A split-piece of a report assigned to a single engineer.

    A report can be divided into multiple splits (2-6), each assigned to a
    different engineer. Each split has its own independent status, executing
    entity, estimated cost, scope description and attachments. The parent
    report's status is automatically updated to "resolved" once all splits
    reach a final state ("resolved" or "closed").
    """

    __tablename__ = "report_splits"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    report_id = Column(Integer, nullable=False, index=True)

    # Engineer assignment (snapshot)
    assigned_engineer = Column(String, nullable=True, index=True)
    assigned_engineer_name = Column(String, nullable=True)

    # Per-split scope and outcome fields
    scope_description = Column(Text, nullable=True)
    status = Column(String, nullable=False, default="open")
    executing_entity = Column(String, nullable=True)
    estimated_cost = Column(Float, nullable=True, default=None)
    notes = Column(Text, nullable=True)
    # Per-split category/department (e.g. "ميكانيكا", "كهرباء"). Optional —
    # admins/owners with `split_reports` permission can set/edit it. Displayed
    # as a Badge next to the assigned engineer's name in the split card UI.
    category = Column(String, nullable=True)

    # Auditing
    status_changed_by = Column(String, nullable=True)
    status_changed_by_name = Column(String, nullable=True)
    created_by = Column(String, nullable=True)
    created_by_name = Column(String, nullable=True)
    is_archived = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=True)


class Report_split_attachments(Base):
    """Files/images attached to a specific report split."""

    __tablename__ = "report_split_attachments"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    split_id = Column(Integer, nullable=False, index=True)
    report_id = Column(Integer, nullable=False, index=True)
    user_id = Column(String, nullable=True)
    object_key = Column(String, nullable=False)
    file_name = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=True)