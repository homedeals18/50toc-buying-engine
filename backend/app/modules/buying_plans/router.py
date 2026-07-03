from fastapi import APIRouter

router = APIRouter(prefix="/buying-plans", tags=["Buying Plans"])


@router.get("/health")
def buying_plans_health() -> dict[str, str]:
    return {"module": "buying_plans", "status": "ready"}
