from fastapi import APIRouter

router = APIRouter()


@router.get("/assistant")
def assistant_insights(assistant_id: str = "") -> dict[str, object]:
    return {"assistant_id": assistant_id, "insights": []}
