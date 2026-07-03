import unittest
from decimal import Decimal

from app.modules.rule_engine.engine import AmazonOffer, Decision, StoreOffer, effective_purchase_limit, evaluate_buying_opportunity


def amazon(**overrides):
    data = {
        "upc": "123",
        "current_fba_price": Decimal("15.00"),
        "fba_seller_count": 10,
        "referral_fee": Decimal("1.00"),
        "fba_fee": Decimal("2.00"),
    }
    data.update(overrides)
    return AmazonOffer(**data)


def offer(**overrides):
    data = {"upc": "123", "chain": "Sam's Club", "store_price": Decimal("8.00")}
    data.update(overrides)
    return StoreOffer(**data)


class RuleEngineTest(unittest.TestCase):
    def test_uses_upc_only_and_rejects_when_no_upc_match(self):
        evaluation = evaluate_buying_opportunity([offer(upc="999")], amazon())

        self.assertEqual(evaluation.decision, Decision.SKIP)
        self.assertIsNone(evaluation.selected_offer)
        self.assertEqual(evaluation.rejection_reasons, ["No store offer matched the Amazon product UPC."])

    def test_buy_when_profit_meets_minimum_and_no_warnings_or_rejections(self):
        evaluation = evaluate_buying_opportunity([offer()], amazon())

        self.assertEqual(evaluation.decision, Decision.BUY)
        self.assertEqual(evaluation.net_profit_per_unit, Decimal("4.00"))
        self.assertEqual(evaluation.warnings, [])
        self.assertEqual(evaluation.rejection_reasons, [])

    def test_rejects_when_net_profit_is_below_three_dollars(self):
        evaluation = evaluate_buying_opportunity([offer(store_price=Decimal("10.00"))], amazon())

        self.assertEqual(evaluation.decision, Decision.SKIP)
        self.assertIn("Net profit per unit is below $3.00 minimum.", evaluation.rejection_reasons)

    def test_lower_current_fba_price_than_expected_is_red_review_warning_not_rejection(self):
        evaluation = evaluate_buying_opportunity(
            [offer()],
            amazon(current_fba_price=Decimal("15.00"), expected_fba_price=Decimal("20.00")),
        )

        self.assertEqual(evaluation.decision, Decision.REVIEW)
        self.assertEqual(evaluation.warnings, ["Current FBA price is lower than expected."])
        self.assertEqual(evaluation.rejection_reasons, [])
        self.assertIs(evaluation.display_flags["show_fba_price_warning_red"], True)

    def test_rejects_amazon_retail_too_many_sellers_hazmat_high_risk_and_blocked_categories(self):
        evaluation = evaluate_buying_opportunity(
            [offer()],
            amazon(amazon_retail_selling=True, fba_seller_count=76, is_hazmat=True, high_risk=True, category="Electronics"),
        )

        self.assertEqual(evaluation.decision, Decision.SKIP)
        self.assertIn("Amazon Retail is selling the product.", evaluation.rejection_reasons)
        self.assertIn("More than 75 FBA sellers are selling the product.", evaluation.rejection_reasons)
        self.assertIn("Product is hazmat.", evaluation.rejection_reasons)
        self.assertIn("Product is high-risk.", evaluation.rejection_reasons)
        self.assertIn("Product category is rejected: electronics.", evaluation.rejection_reasons)

    def test_rejects_furniture(self):
        evaluation = evaluate_buying_opportunity([offer()], amazon(category="Furniture"))

        self.assertEqual(evaluation.decision, Decision.SKIP)
        self.assertIn("Product category is rejected: furniture.", evaluation.rejection_reasons)

    def test_purchase_limits_create_red_warning_and_bjs_is_strict(self):
        evaluation = evaluate_buying_opportunity([offer(chain="BJ's", purchase_limit=4)], amazon())

        self.assertEqual(evaluation.decision, Decision.REVIEW)
        self.assertEqual(evaluation.warnings, ["Purchase limit applies: up to 4 units."])
        self.assertEqual(evaluation.rejection_reasons, [])
        self.assertIs(evaluation.display_flags["show_purchase_limit_red"], True)
        self.assertIs(evaluation.display_flags["purchase_limit_strict"], True)

    def test_costco_business_center_defaults_to_twenty_member_cards_for_effective_limit(self):
        costco_offer = offer(chain="Costco Business Center", purchase_limit=3)

        self.assertEqual(effective_purchase_limit(costco_offer), 60)
        evaluation = evaluate_buying_opportunity([costco_offer], amazon())
        self.assertEqual(evaluation.display_flags["effective_purchase_limit"], 60)

    def test_store_shelf_price_differs_from_online_price_marks_do_not_buy(self):
        evaluation = evaluate_buying_opportunity(
            [offer(shelf_price=Decimal("9.00"), online_price=Decimal("8.00"))],
            amazon(),
        )

        self.assertEqual(evaluation.decision, Decision.SKIP)
        self.assertIn("Store shelf price differs from online price.", evaluation.rejection_reasons)
        self.assertIs(evaluation.display_flags["do_not_buy_price_mismatch"], True)

    def test_same_upc_in_multiple_chains_selects_lowest_store_price(self):
        evaluation = evaluate_buying_opportunity(
            [
                offer(chain="Sam's Club", store_price=Decimal("8.00")),
                offer(chain="BJ's", store_price=Decimal("7.50")),
                offer(chain="Walmart", store_price=Decimal("9.00")),
            ],
            amazon(),
        )

        self.assertIsNotNone(evaluation.selected_offer)
        self.assertEqual(evaluation.selected_offer.chain, "BJ's")
        self.assertEqual(evaluation.selected_offer.store_price, Decimal("7.50"))
        self.assertIs(evaluation.display_flags["lowest_store_price_selected"], True)


if __name__ == "__main__":
    unittest.main()
