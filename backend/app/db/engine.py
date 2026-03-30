from collections.abc import AsyncGenerator
from contextvars import ContextVar

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings

# ContextVar holding the current tenant's schema name (set by TenantMiddleware)
tenant_schema_var: ContextVar[str] = ContextVar("tenant_schema", default="public")


class _TenantSession(AsyncSession):
    """
    AsyncSession subclass that re-applies SET search_path after every commit.

    After session.commit(), asyncpg may start a new implicit transaction on a
    connection whose search_path has been reset (e.g. pool re-acquisition or
    asyncpg internals). Re-setting it here means every route handler gets a
    consistent search_path without any per-handler boilerplate.
    """

    async def commit(self) -> None:
        await super().commit()
        schema = tenant_schema_var.get()
        await self.execute(text(f'SET search_path TO "{schema}", public'))

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
    class_=_TenantSession,
)


async def init_db() -> None:
    """Called at application startup; applies lightweight schema migrations."""
    async with engine.begin() as conn:
        await conn.execute(text("SELECT 1"))
        # Add username column if it doesn't exist yet (idempotent migration)
        await conn.execute(text("""
            DO $$ BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name   = 'users'
                      AND column_name  = 'username'
                ) THEN
                    ALTER TABLE public.users ADD COLUMN username VARCHAR(50);
                    -- Back-fill existing rows with a unique placeholder derived from email
                    UPDATE public.users
                       SET username = LOWER(SPLIT_PART(email, '@', 1))
                                   || LPAD(CAST(EXTRACT(EPOCH FROM NOW())::BIGINT % 10000 AS TEXT), 4, '0')
                     WHERE username IS NULL;
                    ALTER TABLE public.users ALTER COLUMN username SET NOT NULL;
                    CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON public.users (username);
                END IF;
            END $$;
        """))
        # Add phone column if it doesn't exist yet (idempotent migration)
        await conn.execute(text("""
            DO $$ BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name   = 'users'
                      AND column_name  = 'phone'
                ) THEN
                    ALTER TABLE public.users ADD COLUMN phone VARCHAR(20);
                END IF;
            END $$;
        """))
        # Add tenant_name column if it doesn't exist yet (idempotent migration)
        await conn.execute(text("""
            DO $$ BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name   = 'users'
                      AND column_name  = 'tenant_name'
                ) THEN
                    ALTER TABLE public.users ADD COLUMN tenant_name VARCHAR(63);
                    -- Back-fill from the tenants table
                    UPDATE public.users u
                       SET tenant_name = t.schema_name
                      FROM public.tenants t
                     WHERE t.id = u.tenant_id;
                    ALTER TABLE public.users ALTER COLUMN tenant_name SET NOT NULL;
                END IF;
            END $$;
        """))


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
