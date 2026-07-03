from decimal import Decimal

from pydantic import BaseModel, Field

from app.modules.rule_engine.engine import Decision


class StoreOfferInput(BaseModel):
    upc: str
    chain: str
    store_price: Decimal = Field(ge=0)
    online_price: Decimal | None = Field(default=None, ge=0)
    shelf_price: Decimal | None = Field(default=None, ge=0)
    purchase_limit: int | None = Field(default=None, ge=1)
    member_cards: int | None = Field(default=None, ge=1)


class AmazonOfferInput(BaseModel):
    upc: str
    current_fba_price: Decimal | None = Field(default=None, ge=0)
    expected_fba_price: Decimal | None = Field(default=None, ge=0)
    fba_seller_count: int = Field(default=0, ge=0)
    amazon_retail_selling: bool = False
    is_hazmat: bool = False
    category: str | None = None
    high_risk: bool = False
    referral_fee: Decimal = Field(default=Decimal("0"), ge=0)
    fba_fee: Decimal = Field(default=Decimal("0"), ge=0)


class RuleEvaluationRequest(BaseModel):
    store_offers: list[StoreOfferInput]
    amazon_offer: AmazonOfferInput


class StoreOfferOutput(StoreOfferInput):
    pass


class RuleEvaluationResponse(BaseModel):
    decision: Decision
    upc: str
    selected_offer: StoreOfferOutput | None
    net_profit_per_unit: Decimal | None
    warnings: list[str]
    rejection_reasons: list[str]
    display_flags: dict[str, bool | str | int]
