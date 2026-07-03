import unittest
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.core import Store


class ProductCatalogApiTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
        Base.metadata.create_all(bind=self.engine)
        with self.SessionLocal() as db:
            db.add_all([Store(name="Sam's Club", connector_key="sams_club"), Store(name="BJ's", connector_key="bjs")])
            db.commit()

        def override_get_db():
            db = self.SessionLocal()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=self.engine)
        self.engine.dispose()

    def product_payload(self, store_id=1, store_sku="SKU-1"):
        return {
            "upc": "012345678905",
            "brand": "Example Brand",
            "product_name": "Example Product",
            "size": "16 oz",
            "package_quantity": 2,
            "category": "Grocery",
            "store_id": store_id,
            "store_sku": store_sku,
            "online_price": "10.99",
            "shelf_price": "10.99",
            "purchase_limit": 4,
            "store_location": "Aisle 5",
            "amazon_asin": "B000123456",
            "current_fba_price": "19.99",
            "amazon_retail_seller_present": False,
            "number_of_fba_sellers": 12,
            "hazmat": False,
            "high_risk": False,
            "eligible": True,
            "rule_engine_decision": "BUY",
            "warning_flags": [],
            "rejection_reasons": [],
        }

    def test_crud_product_catalog_entry(self):
        create_response = self.client.post("/api/v1/products", json=self.product_payload())
        self.assertEqual(create_response.status_code, 201)
        created = create_response.json()
        self.assertEqual(created["upc"], "012345678905")
        self.assertEqual(Decimal(created["online_price"]), Decimal("10.99"))
        self.assertIn("last_updated_at", created)

        product_id = created["id"]
        get_response = self.client.get(f"/api/v1/products/{product_id}")
        self.assertEqual(get_response.status_code, 200)
        self.assertEqual(get_response.json()["store_sku"], "SKU-1")

        update_response = self.client.patch(
            f"/api/v1/products/{product_id}",
            json={"eligible": False, "rule_engine_decision": "SKIP", "rejection_reasons": ["Product is high-risk."]},
        )
        self.assertEqual(update_response.status_code, 200)
        self.assertFalse(update_response.json()["eligible"])
        self.assertEqual(update_response.json()["rejection_reasons"], ["Product is high-risk."])

        delete_response = self.client.delete(f"/api/v1/products/{product_id}")
        self.assertEqual(delete_response.status_code, 204)
        self.assertEqual(self.client.get(f"/api/v1/products/{product_id}").status_code, 404)

    def test_same_upc_can_be_referenced_by_multiple_stores(self):
        first = self.client.post("/api/v1/products", json=self.product_payload(store_id=1, store_sku="SAMS-1"))
        second = self.client.post("/api/v1/products", json=self.product_payload(store_id=2, store_sku="BJS-1"))

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)

        list_response = self.client.get("/api/v1/products", params={"upc": "012345678905"})
        self.assertEqual(list_response.status_code, 200)
        products = list_response.json()
        self.assertEqual(len(products), 2)
        self.assertEqual({product["store_id"] for product in products}, {1, 2})

    def test_openapi_documents_product_catalog_schema(self):
        response = self.client.get("/openapi.json")
        self.assertEqual(response.status_code, 200)
        schemas = response.json()["components"]["schemas"]
        self.assertIn("ProductCreate", schemas)
        self.assertIn("ProductRead", schemas)
        self.assertIn("upc", schemas["ProductCreate"]["properties"])


if __name__ == "__main__":
    unittest.main()
