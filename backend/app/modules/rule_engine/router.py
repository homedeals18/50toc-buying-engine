from fastapi import APIRouter

router = APIRouter(prefix="/rules", tags=["Rule Engine"])


@router.get("/health")
def rule_engine_health() -> dict[str, str]:
    return {"module": "rule_engine", "status": "ready"}
