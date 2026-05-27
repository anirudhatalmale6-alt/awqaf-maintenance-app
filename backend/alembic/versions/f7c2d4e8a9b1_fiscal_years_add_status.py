"""Add status column to fiscal_years.

Revision ID: f7c2d4e8a9b1
Revises: e5b8f2a3c7d9
Create Date: 2026-04-27

Adds a `status` column so each fiscal year can be marked as
active/completed/expired/cancelled, mirroring the contracts lifecycle.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "f7c2d4e8a9b1"
down_revision = "e5b8f2a3c7d9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Use server_default so existing rows get a valid value and the NOT NULL
    # constraint can be applied safely.
    with op.batch_alter_table("fiscal_years") as batch_op:
        batch_op.add_column(
            sa.Column(
                "status",
                sa.String(),
                nullable=False,
                server_default="active",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("fiscal_years") as batch_op:
        batch_op.drop_column("status")