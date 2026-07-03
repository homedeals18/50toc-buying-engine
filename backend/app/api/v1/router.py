from fastapi import APIRouter

from app.modules.amazon_products.router import router as amazon_products_router
from app.modules.auth.router import router as auth_router
from app.modules.buying_plans.router import router as buying_plans_router
from app.modules.products.router import router as products_router
from app.modules.purchase_history.router import router as purchase_history_router
from app.modules.rule_engine.router import router as rule_engine_router
from app.modules.stores.router import router as stores_router
from app.modules.upc_mapping.router import router as upc_mapping_router

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(stores_router)
api_router.include_router(products_router)
api_router.include_router(upc_mapping_router)
api_router.include_router(amazon_products_router)
api_router.include_router(rule_engine_router)
api_router.include_router(buying_plans_router)
api_router.include_router(purchase_history_router)
