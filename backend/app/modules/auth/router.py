from fastapi import APIRouter

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.get("/health")
def auth_health() -> dict[str, str]:
    return {"module": "authentication", "status": "ready"}
