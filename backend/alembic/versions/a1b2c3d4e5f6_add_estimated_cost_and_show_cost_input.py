"""add estimated_cost to reports and show_cost_input to report_statuses

Revision ID: a1b2c3d4e5f6
Revises: f4e89fc62a70
Create Date: 2026-05-09
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = 'a1b2c3d4e5f6'
down_revision = 'f4e89fc62a70'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('reports', sa.Column('estimated_cost', sa.Float(), nullable=True))
    op.add_column('report_statuses', sa.Column('show_cost_input', sa.Boolean(), nullable=False, server_default=sa.text('false')))


def downgrade() -> None:
    op.drop_column('reports', 'estimated_cost')
    op.drop_column('report_statuses', 'show_cost_input')