"""warranty_items table

Revision ID: d4f6a8c2b1e9
Revises: d3e9c1b5f7a8
Create Date: 2026-05-17 02:30:00.000000

Adds the warranty_items table to track maintenance work currently under
contractor warranty (تحت الكفالة), with claim tracking, source linking, and
status workflow (active / expired / claimed / cancelled).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4f6a8c2b1e9'
down_revision: Union[str, Sequence[str], None] = 'd3e9c1b5f7a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create warranty_items table."""
    op.create_table(
        'warranty_items',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('category', sa.String(), nullable=True),
        sa.Column('category_value', sa.String(), nullable=True),
        sa.Column('mosque_id', sa.Integer(), nullable=True),
        sa.Column('mosque_name', sa.String(), nullable=True),
        sa.Column('region_id', sa.Integer(), nullable=True),
        sa.Column('region_name', sa.String(), nullable=True),
        sa.Column('contractor_id', sa.Integer(), nullable=True),
        sa.Column('contractor_label', sa.String(), nullable=True),
        sa.Column('contractor_value', sa.String(), nullable=True),
        sa.Column('start_date', sa.DateTime(timezone=True), nullable=False),
        sa.Column('duration_months', sa.Integer(), nullable=False, server_default='12'),
        sa.Column('end_date', sa.DateTime(timezone=True), nullable=False),
        sa.Column('cost', sa.Float(), nullable=True),
        sa.Column('status', sa.String(), nullable=False, server_default='active'),
        sa.Column('source_type', sa.String(), nullable=True),
        sa.Column('source_id', sa.Integer(), nullable=True),
        sa.Column('claim_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_claim_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('claim_notes', sa.Text(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('is_archived', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_by', sa.String(), nullable=True),
        sa.Column('created_by_name', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(['mosque_id'], ['mosques.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['contractor_id'], ['contractors.id'], ondelete='SET NULL'),
    )
    op.create_index('ix_warranty_items_status', 'warranty_items', ['status'])
    op.create_index('ix_warranty_items_end_date', 'warranty_items', ['end_date'])
    op.create_index('ix_warranty_items_mosque_id', 'warranty_items', ['mosque_id'])
    op.create_index('ix_warranty_items_contractor_id', 'warranty_items', ['contractor_id'])
    op.create_index(
        'ix_warranty_items_source',
        'warranty_items',
        ['source_type', 'source_id'],
    )


def downgrade() -> None:
    op.drop_index('ix_warranty_items_source', table_name='warranty_items')
    op.drop_index('ix_warranty_items_contractor_id', table_name='warranty_items')
    op.drop_index('ix_warranty_items_mosque_id', table_name='warranty_items')
    op.drop_index('ix_warranty_items_end_date', table_name='warranty_items')
    op.drop_index('ix_warranty_items_status', table_name='warranty_items')
    op.drop_table('warranty_items')