"""
Users API — list tenant users for admin workflows (e.g. linking a user to a doctor profile).
"""
from typing import List, Optional

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_role
from app.db.engine import get_session
from app.models.public.user import Tenant, User

router = APIRouter()


@router.get("", response_model=List[dict])
async def list_users(
    role: Optional[str] = None,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role("hospital_admin", "super_admin")),
):
    """
    Returns all active users belonging to the caller's tenant.
    Optionally filter by role (e.g. role=doctor).
    """
    tenant_schema: str = current_user.get("tenant_schema", "")

    # Resolve tenant_id from schema_name (public schema query)
    tenant = (await session.execute(
        select(Tenant).where(Tenant.schema_name == tenant_schema)
    )).scalar_one_or_none()

    if not tenant:
        return []

    stmt = (
        select(User.id, User.full_name, User.email, User.username, User.role, User.tenant_name)
        .where(User.tenant_id == tenant.id, User.is_active == True)  # noqa: E712
        .order_by(User.full_name)
    )
    if role:
        stmt = stmt.where(User.role == role)

    rows = (await session.execute(stmt)).all()
    return [
        {"id": str(r.id), "full_name": r.full_name, "email": r.email, "username": r.username, "role": r.role, "tenant_name": r.tenant_name}
        for r in rows
    ]
