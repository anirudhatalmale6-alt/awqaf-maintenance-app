"""app_settings value to text

Revision ID: a7f3d9e2b1c4
Revises: 99066fe311ef
Create Date: 2026-04-22 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7f3d9e2b1c4'
down_revision: Union[str, Sequence[str], None] = '99066fe311ef'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema: widen app_settings.value from VARCHAR(500) to TEXT.

    Needed because large JSON blobs (e.g. user_guide_content) exceed 500 chars.
    """
    op.alter_column(
        'app_settings',
        'value',
        existing_type=sa.String(length=500),
        type_=sa.Text(),
        existing_nullable=True,
        postgresql_using='value::text',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column(
        'app_settings',
        'value',
        existing_type=sa.Text(),
        type_=sa.String(length=500),
        existing_nullable=True,
    )