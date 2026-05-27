"""work order licenses tracking

Revision ID: c9f5e3a4d8b2
Revises: b8e4f1a2c5d7
Create Date: 2026-04-27 10:00:00.000000

Adds a JSON `licenses` column to work_orders to track which licenses/permits
have been granted from different authorities:
  - engineering_office (with optional text note)
  - plans
  - electricity
  - fire_safety
  - regulation
  - municipality

Each license is stored as {granted: bool, note?: str}.
A top-level `note` field holds a general licenses note.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c9f5e3a4d8b2'
down_revision: Union[str, Sequence[str], None] = 'b8e4f1a2c5d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add licenses JSON column to work_orders."""
    op.add_column(
        'work_orders',
        sa.Column('licenses', sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('work_orders', 'licenses')