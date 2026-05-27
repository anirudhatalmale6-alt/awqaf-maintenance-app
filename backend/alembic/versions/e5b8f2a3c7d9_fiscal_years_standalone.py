"""fiscal years standalone - add contract_number, contractor_name and make contract_id nullable

Revision ID: e5b8f2a3c7d9
Revises: d1a5c7b9e3f2
Create Date: 2026-04-27 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5b8f2a3c7d9'
down_revision: Union[str, Sequence[str], None] = 'd1a5c7b9e3f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add contract_number, contractor_name snapshot fields and relax contract_id NOT NULL."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'fiscal_years' not in inspector.get_table_names():
        # Table doesn't exist yet; earlier migrations are responsible for it.
        return

    cols = {c['name'] for c in inspector.get_columns('fiscal_years')}

    if 'contract_number' not in cols:
        op.add_column(
            'fiscal_years',
            sa.Column('contract_number', sa.String(), nullable=True),
        )
    if 'contractor_name' not in cols:
        op.add_column(
            'fiscal_years',
            sa.Column('contractor_name', sa.String(), nullable=True),
        )

    # Make contract_id nullable (ignore if already nullable).
    try:
        op.alter_column(
            'fiscal_years',
            'contract_id',
            existing_type=sa.Integer(),
            nullable=True,
        )
    except Exception:
        pass


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'fiscal_years' not in inspector.get_table_names():
        return

    cols = {c['name'] for c in inspector.get_columns('fiscal_years')}
    if 'contractor_name' in cols:
        op.drop_column('fiscal_years', 'contractor_name')
    if 'contract_number' in cols:
        op.drop_column('fiscal_years', 'contract_number')