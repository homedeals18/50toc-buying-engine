"""Product catalog

Revision ID: 0002_product_catalog
Revises: 0001_initial_schema
Create Date: 2026-07-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_product_catalog"
down_revision: str | None = "0001_initial_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("products", sa.Column("upc", sa.String(32), nullable=True))
    op.add_column("products", sa.Column("brand", sa.String(255), nullable=True))
    op.add_column("products", sa.Column("product_name", sa.String(255), nullable=True))
    op.add_column("products", sa.Column("size", sa.String(100), nullable=True))
    op.add_column("products", sa.Column("package_quantity", sa.Integer(), nullable=True))
    op.add_column("products", sa.Column("category", sa.String(100), nullable=True))
    op.add_column("products", sa.Column("store_sku", sa.String(100), nullable=True))
    op.add_column("products", sa.Column("online_price", sa.Numeric(12, 2), nullable=True))
    op.add_column("products", sa.Column("shelf_price", sa.Numeric(12, 2), nullable=True))
    op.add_column("products", sa.Column("purchase_limit", sa.Integer(), nullable=True))
    op.add_column("products", sa.Column("store_location", sa.String(255), nullable=True))
    op.add_column("products", sa.Column("amazon_asin", sa.String(20), nullable=True))
    op.add_column("products", sa.Column("current_fba_price", sa.Numeric(12, 2), nullable=True))
    op.add_column("products", sa.Column("amazon_retail_seller_present", sa.Boolean(), server_default="false", nullable=False))
    op.add_column("products", sa.Column("number_of_fba_sellers", sa.Integer(), nullable=True))
    op.add_column("products", sa.Column("hazmat", sa.Boolean(), server_default="false", nullable=False))
    op.add_column("products", sa.Column("high_risk", sa.Boolean(), server_default="false", nullable=False))
    op.add_column("products", sa.Column("eligible", sa.Boolean(), server_default="true", nullable=False))
    op.add_column("products", sa.Column("rule_engine_decision", sa.String(50), nullable=True))
    op.add_column("products", sa.Column("warning_flags", sa.JSON(), server_default="[]", nullable=False))
    op.add_column("products", sa.Column("rejection_reasons", sa.JSON(), server_default="[]", nullable=False))
    op.add_column("products", sa.Column("last_updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))

    op.execute("UPDATE products SET product_name = name, store_sku = sku, online_price = unit_price, shelf_price = unit_price, upc = 'UNKNOWN-' || id WHERE product_name IS NULL")
    op.alter_column("products", "upc", existing_type=sa.String(32), nullable=False)
    op.alter_column("products", "product_name", existing_type=sa.String(255), nullable=False)

    op.create_index("ix_products_upc", "products", ["upc"])
    op.create_index("ix_products_brand", "products", ["brand"])
    op.create_index("ix_products_product_name", "products", ["product_name"])
    op.create_index("ix_products_category", "products", ["category"])
    op.create_index("ix_products_store_id", "products", ["store_id"])
    op.create_index("ix_products_store_sku", "products", ["store_sku"])
    op.create_index("ix_products_amazon_asin", "products", ["amazon_asin"])
    op.create_index("ix_products_rule_engine_decision", "products", ["rule_engine_decision"])
    op.create_unique_constraint("uq_products_store_sku", "products", ["store_id", "store_sku"])

    op.drop_column("products", "unit_price")
    op.drop_column("products", "sku")
    op.drop_column("products", "name")


def downgrade() -> None:
    op.add_column("products", sa.Column("name", sa.String(255), nullable=True))
    op.add_column("products", sa.Column("sku", sa.String(100), nullable=True))
    op.add_column("products", sa.Column("unit_price", sa.Numeric(12, 2), nullable=True))
    op.execute("UPDATE products SET name = product_name, sku = store_sku, unit_price = online_price")
    op.alter_column("products", "name", existing_type=sa.String(255), nullable=False)

    op.drop_constraint("uq_products_store_sku", "products", type_="unique")
    for index_name in [
        "ix_products_rule_engine_decision",
        "ix_products_amazon_asin",
        "ix_products_store_sku",
        "ix_products_store_id",
        "ix_products_category",
        "ix_products_product_name",
        "ix_products_brand",
        "ix_products_upc",
    ]:
        op.drop_index(index_name, table_name="products")

    for column_name in [
        "last_updated_at",
        "rejection_reasons",
        "warning_flags",
        "rule_engine_decision",
        "eligible",
        "high_risk",
        "hazmat",
        "number_of_fba_sellers",
        "amazon_retail_seller_present",
        "current_fba_price",
        "amazon_asin",
        "store_location",
        "purchase_limit",
        "shelf_price",
        "online_price",
        "store_sku",
        "category",
        "package_quantity",
        "size",
        "product_name",
        "brand",
        "upc",
    ]:
        op.drop_column("products", column_name)
