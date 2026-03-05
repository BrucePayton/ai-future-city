from fastapi import FastAPI

from routers.evaluation import router as evaluation_router
from routers.experience import router as experience_router

app = FastAPI(title="AIFutureCity Knowledge Service")
app.include_router(experience_router, prefix="/experience", tags=["experience"])
app.include_router(evaluation_router, prefix="/evaluation", tags=["evaluation"])


@app.get("/healthz")
def healthcheck() -> dict[str, object]:
    return {"ok": True, "service": "knowledge-service"}
