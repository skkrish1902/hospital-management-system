from collections.abc import AsyncGenerator
from contextvars import ContextVar

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings

# ContextVar holding the current tenant's schema name (set by TenantMiddleware)
tenant_schema_var: ContextVar[str] = ContextVar("tenant_schema", default="public")

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,
    class_=AsyncSession,
)


async def init_db() -> None:
    """Called at application startup to verify DB connectivity."""
    async with engine.begin() as conn:
        await conn.execute(__import__("sqlalchemy").text("SELECT 1"))


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI dependency that yields a DB session with the correct
    tenant search_path already set.
    """
    schema = tenant_schema_var.get()
    async with AsyncSessionLocal() as session:
        # Set PostgreSQL search_path for this session so all queries
        # are scoped to the tenant schema without explicit schema prefixes.
        await session.execute(
            __import__("sqlalchemy").text(f'SET search_path TO "{schema}", public')
        )
        yield session
