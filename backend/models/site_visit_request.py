"""SiteVisitRequest model — represents an electronic site-visit (بدل موقع)
approval request that flows through head-of-department → maintenance-supervisor
→ department-director signature stages.
"""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.sql import func

from models.base import Base


class SiteVisitRequest(Base):
    """A site-visit allowance request awaiting up to 4 stages of approval.

    Status progression:
      pending_audit → pending_head → pending_supervisor → pending_director → approved

    Special status:
      rejected_audit — the auditor rejected the request; submitter can fix it.
    """

    __tablename__ = "site_visit_requests"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Submitter
    owner_id = Column(String(255), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    owner_name = Column(String(255), nullable=True)

    # Form header fields (snapshot)
    civil_id = Column(String(50), nullable=True)
    job_title = Column(String(255), nullable=True)
    month = Column(Integer, nullable=True)
    year = Column(Integer, nullable=True)
    area = Column(String(255), nullable=True)
    reason = Column(String(500), nullable=True)

    # Table rows (12 visit rows) stored as JSON text:
    # [{date, mosque, description, distance, duration, signature, ...}, ...]
    rows = Column(Text, nullable=True)

    # Three signature stages — each holds the data-URL of the e-signature
    head_signature = Column(Text, nullable=True)
    supervisor_signature = Column(Text, nullable=True)
    director_signature = Column(Text, nullable=True)

    head_signed_at = Column(DateTime(timezone=True), nullable=True)
    supervisor_signed_at = Column(DateTime(timezone=True), nullable=True)
    director_signed_at = Column(DateTime(timezone=True), nullable=True)

    head_signed_by = Column(String(255), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    supervisor_signed_by = Column(String(255), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    director_signed_by = Column(String(255), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    head_signed_by_name = Column(String(255), nullable=True)
    supervisor_signed_by_name = Column(String(255), nullable=True)
    director_signed_by_name = Column(String(255), nullable=True)

    # ---- Audit stage (NEW) ----
    # Filled when a user with `audit_site_visit` permission approves or
    # rejects the request at the initial pending_audit stage. The auditor
    # acts as a gatekeeper before the request enters the 3-stage signing
    # chain (head → supervisor → director).
    audited_by_id = Column(
        String(255),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    audited_by_name = Column(String(255), nullable=True)
    audited_at = Column(DateTime(timezone=True), nullable=True)
    # Free-text note. For rejections, the auditor MUST provide a reason here
    # so the submitter knows what to fix. For approvals it can stay null.
    audit_note = Column(Text, nullable=True)

    # Optional attendance/signature attachment image (relative web path
    # under /uploads/site-visit-attendance/, served by main.py's StaticFiles
    # mount). Populated via POST /api/v1/site-visits/upload-attendance.
    attendance_attachment = Column(String(500), nullable=True)

    # Timestamp set whenever the original submitter edits the request after
    # the auditor rejected it (status was `rejected_audit` → user calls
    # POST /update or replaces the attendance image → request is re-queued
    # back to `pending_audit`). Lets the auditor see at a glance that the
    # request is a re-submission rather than a brand-new one.
    edited_after_audit_at = Column(DateTime(timezone=True), nullable=True)

    # Workflow status. New default is `pending_audit` — the request must
    # first be audited by a user with the `audit_site_visit` permission
    # before it enters the 3-stage signing chain. Existing rows in the DB
    # keep their stored value (server_default only applies to NEW rows).
    status = Column(
        String(50),
        nullable=False,
        default="pending_audit",
        server_default="pending_audit",
        index=True,
    )

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )