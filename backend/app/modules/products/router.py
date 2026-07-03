from fastapi import APIRouter

router = APIRouter(prefix="/products", tags=["Products"])


@router.get("/health")
def products_health() -> dict[str, str]:
    return {"module": "products", "status": "ready"}
