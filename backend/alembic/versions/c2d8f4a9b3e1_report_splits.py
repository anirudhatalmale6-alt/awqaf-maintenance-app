"""report_splits and report_split_attachments + reports.is_split

Revision ID: c2d8f4a9b3e1
Revises: a7f3d9e2b1c4
Create Date: 2026-05-15 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c2d8f4a9b3e1'
down_revision: Union[str, Sequence[str], None] = 'a7f3d9e2b1c4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create report_splits and report_split_attachments tables; add is_split flag to reports."""
    # 1. Add is_split column to reports
    op.add_column(
        'reports',
        sa.Column('is_split', sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    # 2. Create report_splits table
    op.create_table(
        'report_splits',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column('report_id', sa.Integer(), nullable=False),
        sa.Column('assigned_engineer', sa.String(), nullable=True),
        sa.Column('assigned_engineer_name', sa.String(), nullable=True),
        sa.Column('scope_description', sa.Text(), nullable=True),
        sa.Column('status', sa.String(), nullable=False, server_default='open'),
        sa.Column('executing_entity', sa.String(), nullable=True),
        sa.Column('estimated_cost', sa.Float(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('status_changed_by', sa.String(), nullable=True),
        sa.Column('status_changed_by_name', sa.String(), nullable=True),
        sa.Column('created_by', sa.String(), nullable=True),
        sa.Column('created_by_name', sa.String(), nullable=True),
        sa.Column('is_archived', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_report_splits_report_id', 'report_splits', ['report_id'])
    op.create_index('ix_report_splits_assigned_engineer', 'report_splits', ['assigned_engineer'])

    # 3. Create report_split_attachments table
    op.create_table(
        'report_split_attachments',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column('split_id', sa.Integer(), nullable=False),
        sa.Column('report_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=True),
        sa.Column('object_key', sa.String(), nullable=False),
        sa.Column('file_name', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_report_split_attachments_split_id', 'report_split_attachments', ['split_id'])
    op.create_index('ix_report_split_attachments_report_id', 'report_split_attachments', ['report_id'])


def downgrade() -> None:
    """Reverse the upgrade."""
    op.drop_index('ix_report_split_attachments_report_id', table_name='report_split_attachments')
    op.drop_index('ix_report_split_attachments_split_id', table_name='report_split_attachments')
    op.drop_table('report_split_attachments')

    op.drop_index('ix_report_splits_assigned_engineer', table_name='report_splits')
    op.drop_index('ix_report_splits_report_id', table_name='report_splits')
    op.drop_table('report_splits')

    op.drop_column('reports', 'is_split')