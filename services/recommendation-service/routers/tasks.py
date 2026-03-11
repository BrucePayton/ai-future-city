from fastapi import APIRouter

router = APIRouter()


@router.get("/recommend")
def recommend_tasks(assistant_id: str = "") -> dict[str, object]:
    return {"assistant_id": assistant_id, "tasks": []}
