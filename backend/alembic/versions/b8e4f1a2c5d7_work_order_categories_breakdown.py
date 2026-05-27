"""work order categories breakdown

Revision ID: b8e4f1a2c5d7
Revises: a7f3d9e2b1c4
Create Date: 2026-04-26 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8e4f1a2c5d7'
down_revision: Union[str, Sequence[str], None] = 'a7f3d9e2b1c4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add categories_breakdown JSON column to work_orders."""
    op.add_column(
        'work_orders',
        sa.Column('categories_breakdown', sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('work_orders', 'categories_breakdown')