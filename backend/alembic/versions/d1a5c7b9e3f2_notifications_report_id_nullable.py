"""notifications.report_id nullable + contract_notification_subscriptions table

Revision ID: d1a5c7b9e3f2
Revises: c9f5e3a4d8b2
Create Date: 2026-04-27 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "d1a5c7b9e3f2"
down_revision = "c9f5e3a4d8b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Make notifications.report_id nullable (to support contract/work-order notifications
    #    that are not tied to a specific report).
    try:
        op.alter_column(
            "notifications",
            "report_id",
            existing_type=sa.Integer(),
            nullable=True,
        )
    except Exception:
        # If the column is already nullable, ignore
        pass

    # 2. Create contract_notification_subscriptions table
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names()
    if "contract_notification_subscriptions" not in existing_tables:
        op.create_table(
            "contract_notification_subscriptions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
            sa.Column("user_id", sa.String(), nullable=False, unique=True, index=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=True,
                server_default=sa.text("CURRENT_TIMESTAMP"),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=True,
                server_default=sa.text("CURRENT_TIMESTAMP"),
            ),
        )


def downgrade() -> None:
    try:
        op.drop_table("contract_notification_subscriptions")
    except Exception:
        pass
    try:
        op.alter_column(
            "notifications",
            "report_id",
            existing_type=sa.Integer(),
            nullable=False,
        )
    except Exception:
        pass