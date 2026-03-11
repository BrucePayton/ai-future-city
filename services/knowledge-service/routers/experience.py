from fastapi import APIRouter

router = APIRouter()


@router.get("/search")
def search_experience(query: str = "") -> dict[str, object]:
    return {"query": query, "results": []}
