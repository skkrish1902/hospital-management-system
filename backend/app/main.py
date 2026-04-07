from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.db.engine import init_db
from app.middleware.tenant import TenantMiddleware
from app.websocket.manager import ws_manager
from app.websocket.redis_bridge import start_redis_subscriber
from app.api.v1.router import api_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    await start_redis_subscriber(ws_manager)
    yield
    # Shutdown — nothing to clean up explicitly; connections close on process exit


app = FastAPI(
    title="Smart Hospital — OPD API",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Tenant resolution middleware (must come after CORS)
app.add_middleware(TenantMiddleware)

# API routes
app.include_router(api_router, prefix="/api/v1")

# WebSocket endpoint
from app.websocket.router import ws_router  # noqa: E402
app.include_router(ws_router)

# Serve uploaded lab reports (and any future uploads)
_uploads_dir = Path("/app/uploads")
_uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_uploads_dir)), name="uploads")


@app.get("/health", tags=["health"])
async def health_check():
    return {"status": "ok", "service": "hospital-opd-api"}
