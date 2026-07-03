"""Initial schema

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-07-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001_initial_schema"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table("users", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("email", sa.String(255), nullable=False), sa.Column("hashed_password", sa.String(255), nullable=False), sa.Column("full_name", sa.String(255)), *timestamps())
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_table("stores", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("name", sa.String(255), nullable=False), sa.Column("connector_key", sa.String(100)), *timestamps())
    op.create_index("ix_stores_name", "stores", ["name"], unique=True)
    op.create_table("amazon_products", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("asin", sa.String(20), nullable=False), sa.Column("title", sa.String(255), nullable=False), sa.Column("current_price", sa.Numeric(12, 2)), *timestamps())
    op.create_index("ix_amazon_products_asin", "amazon_products", ["asin"], unique=True)
    op.create_table("buying_rules", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("name", sa.String(255), nullable=False), sa.Column("description", sa.Text()), sa.Column("expression", sa.Text(), nullable=False), *timestamps())
    op.create_table("buying_plans", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("name", sa.String(255), nullable=False), sa.Column("status", sa.String(50), nullable=False), *timestamps())
    op.create_table("products", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("store_id", sa.Integer(), sa.ForeignKey("stores.id"), nullable=False), sa.Column("name", sa.String(255), nullable=False), sa.Column("sku", sa.String(100)), sa.Column("unit_price", sa.Numeric(12, 2)), *timestamps())
    op.create_table("upc_mappings", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("upc", sa.String(32), nullable=False), sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=False), *timestamps())
    op.create_table("purchase_history", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=False), sa.Column("quantity", sa.Integer(), nullable=False), sa.Column("total_cost", sa.Numeric(12, 2), nullable=False), *timestamps())


def downgrade() -> None:
    for table in ["purchase_history", "upc_mappings", "products", "buying_plans", "buying_rules", "amazon_products", "stores", "users"]:
        op.drop_table(table)
