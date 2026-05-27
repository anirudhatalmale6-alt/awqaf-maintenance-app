"""report_splits add category column (and merge heads)

Revision ID: d3e9c1b5f7a8
Revises: c2d8f4a9b3e1, a1b2c3d4e5f6
Create Date: 2026-05-15 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd3e9c1b5f7a8'
down_revision: Union[str, Sequence[str], None] = ('c2d8f4a9b3e1', 'a1b2c3d4e5f6')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add per-split category column to report_splits."""
    with op.batch_alter_table('report_splits') as batch_op:
        batch_op.add_column(sa.Column('category', sa.String(), nullable=True))


def downgrade() -> None:
    """Drop the category column from report_splits."""
    with op.batch_alter_table('report_splits') as batch_op:
        batch_op.drop_column('category')