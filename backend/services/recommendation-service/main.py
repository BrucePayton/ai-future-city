from fastapi import FastAPI

from routers.insights import router as insights_router
from routers.tasks import router as tasks_router

app = FastAPI(title="AIFutureCity Recommendation Service")
app.include_router(tasks_router, prefix="/tasks", tags=["tasks"])
app.include_router(insights_router, prefix="/insights", tags=["insights"])


@app.get("/healthz")
def healthcheck() -> dict[str, object]:
    return {"ok": True, "service": "recommendation-service"}
