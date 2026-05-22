"""create brain schema (idempotent placeholder; tables land in Phase 2+).

Revision ID: 0001
Revises:
Create Date: 2026-05-22 00:00:00

"""
from __future__ import annotations

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS brain")


def downgrade() -> None:
    # Intentionally empty: dropping the schema would cascade-drop user data.
    # Phase 2+ revisions that create tables inside `brain.*` must implement
    # their own table-level `downgrade()`.
    pass
