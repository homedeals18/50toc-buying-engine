from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str | None] = mapped_column(String(255))


class Store(TimestampMixin, Base):
    __tablename__ = "stores"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    connector_key: Mapped[str | None] = mapped_column(String(100), unique=True)
    products: Mapped[list["Product"]] = relationship(back_populates="store")


class Product(TimestampMixin, Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id"))
    name: Mapped[str] = mapped_column(String(255), index=True)
    sku: Mapped[str | None] = mapped_column(String(100), index=True)
    unit_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    store: Mapped[Store] = relationship(back_populates="products")


class UpcMapping(TimestampMixin, Base):
    __tablename__ = "upc_mappings"

    id: Mapped[int] = mapped_column(primary_key=True)
    upc: Mapped[str] = mapped_column(String(32), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))


class AmazonProduct(TimestampMixin, Base):
    __tablename__ = "amazon_products"

    id: Mapped[int] = mapped_column(primary_key=True)
    asin: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(255))
    current_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))


class BuyingRule(TimestampMixin, Base):
    __tablename__ = "buying_rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    expression: Mapped[str] = mapped_column(Text)


class BuyingPlan(TimestampMixin, Base):
    __tablename__ = "buying_plans"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    status: Mapped[str] = mapped_column(String(50), default="draft")


class PurchaseHistory(TimestampMixin, Base):
    __tablename__ = "purchase_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[int] = mapped_column(Integer)
    total_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2))
