from fastapi import APIRouter

router = APIRouter(prefix="/stores", tags=["Stores"])


@router.get("/health")
def stores_health() -> dict[str, str]:
    return {"module": "stores", "status": "ready"}
