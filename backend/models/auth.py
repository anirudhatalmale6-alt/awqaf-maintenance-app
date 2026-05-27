from models.base import Base
from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func


class User(Base):
    __tablename__ = "users"
    __table_args__ = {"extend_existing": True}

    id = Column(String(255), primary_key=True, index=True)  # Use platform sub as primary key
    email = Column(String(255), nullable=False)
    name = Column(String(255), nullable=True)
    phone = Column(String(50), nullable=True, default=None)  # phone number (optional)
    role = Column(String(50), default="user", nullable=False)  # user/admin
    member_tag = Column(String(100), nullable=True, default=None)  # member tag assigned by admin
    specialization = Column(String(255), nullable=True, default=None)  # engineer specialization
    custom_permissions = Column(Text, nullable=True, default=None)  # JSON: individual permission overrides
    is_approved = Column(Boolean, default=True, nullable=False)  # Admin approval status for self-registered users
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_login = Column(DateTime(timezone=True), nullable=True)


class OIDCState(Base):
    __tablename__ = "oidc_states"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True)
    state = Column(String(255), unique=True, index=True, nullable=False)
    nonce = Column(String(255), nullable=False)
    code_verifier = Column(String(255), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
