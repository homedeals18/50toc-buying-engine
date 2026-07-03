from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from enum import StrEnum


class Decision(StrEnum):
    BUY = "buy"
    SKIP = "skip"
    REVIEW = "review"


@dataclass(frozen=True)
class StoreOffer:
    upc: str
    chain: str
    store_price: Decimal
    online_price: Decimal | None = None
    shelf_price: Decimal | None = None
    purchase_limit: int | None = None
    member_cards: int | None = None


@dataclass(frozen=True)
class AmazonOffer:
    upc: str
    current_fba_price: Decimal | None
    expected_fba_price: Decimal | None = None
    fba_seller_count: int = 0
    amazon_retail_selling: bool = False
    is_hazmat: bool = False
    category: str | None = None
    high_risk: bool = False
    referral_fee: Decimal = Decimal("0")
    fba_fee: Decimal = Decimal("0")


@dataclass(frozen=True)
class RuleEvaluation:
    decision: Decision
    upc: str
    selected_offer: StoreOffer | None
    net_profit_per_unit: Decimal | None
    warnings: list[str] = field(default_factory=list)
    rejection_reasons: list[str] = field(default_factory=list)
    display_flags: dict[str, bool | str | int] = field(default_factory=dict)


MIN_NET_PROFIT = Decimal("3.00")
MAX_FBA_SELLERS = 75
DEFAULT_COSTCO_BUSINESS_CENTER_MEMBER_CARDS = 20
STRICT_LIMIT_CHAINS = {"bj's", "bjs", "bj’s"}
CATEGORY_REJECTIONS = {"electronics", "furniture"}


def evaluate_buying_opportunity(store_offers: list[StoreOffer], amazon_offer: AmazonOffer) -> RuleEvaluation:
    """Evaluate a UPC-matched buying opportunity using 50TOC MVP business rules."""
    matching_offers = [offer for offer in store_offers if offer.upc == amazon_offer.upc]
    warnings: list[str] = []
    rejection_reasons: list[str] = []
    display_flags: dict[str, bool | str | int] = {
        "matched_by": "upc",
        "show_fba_price_warning_red": False,
        "show_purchase_limit_red": False,
        "lowest_store_price_selected": False,
    }

    if not matching_offers:
        rejection_reasons.append("No store offer matched the Amazon product UPC.")
        return RuleEvaluation(
            decision=Decision.SKIP,
            upc=amazon_offer.upc,
            selected_offer=None,
            net_profit_per_unit=None,
            warnings=warnings,
            rejection_reasons=rejection_reasons,
            display_flags=display_flags,
        )

    selected_offer = min(matching_offers, key=lambda offer: offer.store_price)
    if len({offer.chain.lower() for offer in matching_offers}) > 1:
        display_flags["lowest_store_price_selected"] = True

    _apply_rejection_rules(selected_offer, amazon_offer, rejection_reasons)
    _apply_warning_rules(selected_offer, amazon_offer, warnings, display_flags)
    net_profit_per_unit = _net_profit_per_unit(selected_offer, amazon_offer)

    if net_profit_per_unit is None:
        rejection_reasons.append("Current FBA selling price is required for MVP evaluation.")
    elif net_profit_per_unit < MIN_NET_PROFIT:
        rejection_reasons.append("Net profit per unit is below $3.00 minimum.")

    if _store_shelf_differs_from_online(selected_offer):
        rejection_reasons.append("Store shelf price differs from online price.")
        display_flags["do_not_buy_price_mismatch"] = True

    decision = Decision.SKIP if rejection_reasons else Decision.REVIEW if warnings else Decision.BUY
    return RuleEvaluation(
        decision=decision,
        upc=amazon_offer.upc,
        selected_offer=selected_offer,
        net_profit_per_unit=net_profit_per_unit,
        warnings=warnings,
        rejection_reasons=rejection_reasons,
        display_flags=display_flags,
    )


def _apply_rejection_rules(selected_offer: StoreOffer, amazon_offer: AmazonOffer, rejection_reasons: list[str]) -> None:
    if amazon_offer.amazon_retail_selling:
        rejection_reasons.append("Amazon Retail is selling the product.")
    if amazon_offer.fba_seller_count > MAX_FBA_SELLERS:
        rejection_reasons.append("More than 75 FBA sellers are selling the product.")
    if amazon_offer.is_hazmat:
        rejection_reasons.append("Product is hazmat.")
    if amazon_offer.high_risk:
        rejection_reasons.append("Product is high-risk.")
    category = (amazon_offer.category or "").strip().lower()
    if category in CATEGORY_REJECTIONS:
        rejection_reasons.append(f"Product category is rejected: {category}.")


def _apply_warning_rules(
    selected_offer: StoreOffer,
    amazon_offer: AmazonOffer,
    warnings: list[str],
    display_flags: dict[str, bool | str | int],
) -> None:
    if amazon_offer.current_fba_price is not None and amazon_offer.expected_fba_price is not None:
        if amazon_offer.current_fba_price < amazon_offer.expected_fba_price:
            warnings.append("Current FBA price is lower than expected.")
            display_flags["show_fba_price_warning_red"] = True

    if selected_offer.purchase_limit is not None:
        effective_limit = effective_purchase_limit(selected_offer)
        warnings.append(f"Purchase limit applies: up to {effective_limit} units.")
        display_flags["show_purchase_limit_red"] = True
        display_flags["effective_purchase_limit"] = effective_limit
        if selected_offer.chain.strip().lower() in STRICT_LIMIT_CHAINS:
            display_flags["purchase_limit_strict"] = True


def effective_purchase_limit(offer: StoreOffer) -> int:
    if offer.purchase_limit is None:
        raise ValueError("Cannot calculate an effective purchase limit without a purchase limit.")
    if offer.chain.strip().lower() == "costco business center":
        member_cards = offer.member_cards or DEFAULT_COSTCO_BUSINESS_CENTER_MEMBER_CARDS
        return offer.purchase_limit * member_cards
    return offer.purchase_limit


def _net_profit_per_unit(selected_offer: StoreOffer, amazon_offer: AmazonOffer) -> Decimal | None:
    if amazon_offer.current_fba_price is None:
        return None
    return amazon_offer.current_fba_price - selected_offer.store_price - amazon_offer.referral_fee - amazon_offer.fba_fee


def _store_shelf_differs_from_online(offer: StoreOffer) -> bool:
    if offer.shelf_price is None or offer.online_price is None:
        return False
    return offer.shelf_price != offer.online_price
