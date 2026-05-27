"""add icon to report_statuses

Revision ID: f4e89fc62a70
Revises: f3f25ffad854
Create Date: 2026-05-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f4e89fc62a70'
down_revision: Union[str, None] = 'f7c2d4e8a9b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('report_statuses', sa.Column('icon', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('report_statuses', 'icon')