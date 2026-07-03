from fastapi import APIRouter

router = APIRouter(prefix="/purchase-history", tags=["Purchase History"])


@router.get("/health")
def purchase_history_health() -> dict[str, str]:
    return {"module": "purchase_history", "status": "ready"}
