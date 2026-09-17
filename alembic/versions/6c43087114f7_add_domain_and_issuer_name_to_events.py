"""add domain and issuer name to events

Revision ID: 6c43087114f7
Revises: ed0045394361
Create Date: 2026-09-16 10:18:17.217827

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6c43087114f7'
down_revision: Union[str, Sequence[str], None] = 'ed0045394361'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "events",
        sa.Column(
            "domain",
            sa.String(length=255),
            nullable=True,
        ),

    )

    op.add_column(
        "events",
        sa.Column(
            "issuer_name",
            sa.String(length=255),
            nullable=True,
        ),

    )

    op.execute(
        sa.text(
            """
            UPDATE events
            SET issuer_name = 'iPAS 資安證照討論區'
            WHERE issuer_name IS NULL
            """
        )
    )

    op.alter_column(
        "events",
        "issuer_name",
        existing_type=sa.String(length=255),
        nullable=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("events", "issuer_name")
    op.drop_column("events", "domain")
