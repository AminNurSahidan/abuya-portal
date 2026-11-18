from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from app.config import settings
from app.database import Base, engine
from app.routers import auth, dashboard, logs, master, purchasing, roles, users, warehouse


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.auto_create_tables:
        from app.cli import apply_one_time_grants, ensure_default_brands, ensure_default_roles, sync_schema

        Base.metadata.create_all(engine)
        sync_schema()
        with Session(engine) as db:
            ensure_default_brands(db)
            ensure_default_roles(db)
            apply_one_time_grants(db)
            db.commit()
    yield


app = FastAPI(
    title="Abuya Portal API",
    version="1.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    redoc_url=None,
    lifespan=lifespan,
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
app.include_router(roles.router)
app.include_router(master.router)
app.include_router(dashboard.router)
app.include_router(logs.router)
app.include_router(warehouse.router)
app.include_router(purchasing.router)


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