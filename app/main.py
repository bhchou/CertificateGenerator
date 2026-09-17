import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .db import check_database
from .events import router as events_router
from .apply import router as apply_router
from .certificates import router as certificates_router
from .config import settings


STATIC_DIR = Path(__file__).parent / "static"
ENABLE_API_DOCS = settings.enable_api_docs

app = FastAPI(
    title="Participation Certificate Generator",
    version="0.1.0",
    doc_url="/docs" if ENABLE_API_DOCS else None,
    redoc_url="/redoc" if ENABLE_API_DOCS else None,
    openapi_url="/openapi.json" if ENABLE_API_DOCS else None,
)
app.mount(
    "/static",
    StaticFiles(directory="app/static"),
    name="static",
)
app.include_router(events_router)
app.include_router(apply_router)
app.include_router(certificates_router)

@app.get("/health")
def health():
    return {
        "status": "ok",
    }


@app.get("/health/db")
def health_db():
    try:
        if not check_database():
            raise HTTPException(
                status_code=503,
                detail="Database check failed",
            )

    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Database unavailable",
        )

    return {
        "status": "ok",
        "database": "connected",
    }

@app.get("/apply", include_in_schema=False)
async def apply_page():
    return FileResponse(STATIC_DIR / "apply.html")

@app.get("/verify", include_in_schema=False)
def verify_page():
    return FileResponse(
        STATIC_DIR / "verify.html"
    )

