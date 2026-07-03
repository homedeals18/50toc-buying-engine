from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class ProductBase(BaseModel):
    upc: str = Field(..., min_length=1, max_length=32, description="UPC used as the shared product identifier across stores.")
    brand: str | None = Field(default=None, max_length=255)
    product_name: str = Field(..., min_length=1, max_length=255)
    size: str | None = Field(default=None, max_length=100)
    package_quantity: int | None = Field(default=None, ge=1)
    category: str | None = Field(default=None, max_length=100)
    store_id: int = Field(..., description="Store that carries this UPC.")
    store_sku: str | None = Field(default=None, max_length=100)
    online_price: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    shelf_price: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    purchase_limit: int | None = Field(default=None, ge=0)
    store_location: str | None = Field(default=None, max_length=255)
    amazon_asin: str | None = Field(default=None, max_length=20)
    current_fba_price: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    amazon_retail_seller_present: bool = False
    number_of_fba_sellers: int | None = Field(default=None, ge=0)
    hazmat: bool = False
    high_risk: bool = False
    eligible: bool = True
    rule_engine_decision: str | None = Field(default=None, max_length=50)
    warning_flags: list[str] = Field(default_factory=list)
    rejection_reasons: list[str] = Field(default_factory=list)


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    upc: str | None = Field(default=None, min_length=1, max_length=32)
    brand: str | None = Field(default=None, max_length=255)
    product_name: str | None = Field(default=None, min_length=1, max_length=255)
    size: str | None = Field(default=None, max_length=100)
    package_quantity: int | None = Field(default=None, ge=1)
    category: str | None = Field(default=None, max_length=100)
    store_id: int | None = None
    store_sku: str | None = Field(default=None, max_length=100)
    online_price: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    shelf_price: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    purchase_limit: int | None = Field(default=None, ge=0)
    store_location: str | None = Field(default=None, max_length=255)
    amazon_asin: str | None = Field(default=None, max_length=20)
    current_fba_price: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    amazon_retail_seller_present: bool | None = None
    number_of_fba_sellers: int | None = Field(default=None, ge=0)
    hazmat: bool | None = None
    high_risk: bool | None = None
    eligible: bool | None = None
    rule_engine_decision: str | None = Field(default=None, max_length=50)
    warning_flags: list[str] | None = None
    rejection_reasons: list[str] | None = None


class ProductRead(ProductBase):
    id: int
    last_updated_at: datetime
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
