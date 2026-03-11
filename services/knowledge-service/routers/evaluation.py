from fastapi import APIRouter

router = APIRouter()


@router.post("/assistant")
def evaluate_assistant(payload: dict[str, object]) -> dict[str, object]:
    return {"received": payload, "score": None}
