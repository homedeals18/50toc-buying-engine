from fastapi import APIRouter

from app.modules.rule_engine.engine import AmazonOffer, StoreOffer, evaluate_buying_opportunity
from app.modules.rule_engine.schemas import RuleEvaluationRequest, RuleEvaluationResponse

router = APIRouter(prefix="/rules", tags=["Rule Engine"])


@router.get("/health")
def rule_engine_health() -> dict[str, str]:
    return {"module": "rule_engine", "status": "ready"}


@router.post("/evaluate", response_model=RuleEvaluationResponse)
def evaluate_rules(payload: RuleEvaluationRequest) -> RuleEvaluationResponse:
    evaluation = evaluate_buying_opportunity(
        store_offers=[StoreOffer(**offer.model_dump()) for offer in payload.store_offers],
        amazon_offer=AmazonOffer(**payload.amazon_offer.model_dump()),
    )
    return RuleEvaluationResponse.model_validate(evaluation, from_attributes=True)
