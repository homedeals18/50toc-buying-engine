from fastapi import APIRouter

router = APIRouter(prefix="/amazon-products", tags=["Amazon Products"])


@router.get("/health")
def amazon_products_health() -> dict[str, str]:
    return {"module": "amazon_products", "status": "ready"}
