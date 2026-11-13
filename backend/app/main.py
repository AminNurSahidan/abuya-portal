from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.routers import auth, dashboard, master, users

app = FastAPI(
    title="Abuya Portal API",
    version="1.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    redoc_url=None,
)

if settings.cors_list:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_list,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(master.router)
app.include_router(dashboard.router)


@app.get("/api/health", tags=["system"])
def health():
    return {"status": "ok"}


if settings.frontend_dir:
    frontend = Path(settings.frontend_dir).resolve()
    if frontend.is_dir():

        @app.get("/", include_in_schema=False)
        def root():
            return RedirectResponse(url="/login.html")

        app.mount("/", StaticFiles(directory=frontend, html=True), name="frontend")
