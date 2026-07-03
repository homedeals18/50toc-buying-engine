from fastapi import APIRouter

router = APIRouter(prefix="/upc-mappings", tags=["UPC Mapping"])


@router.get("/health")
def upc_mapping_health() -> dict[str, str]:
    return {"module": "upc_mapping", "status": "ready"}
