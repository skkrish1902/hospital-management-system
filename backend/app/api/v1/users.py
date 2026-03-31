"""
Users API — list, create, and manage tenant staff users (hospital_admin only).
Doctors are excluded; use POST /doctors/onboard instead.
"""
import uuid as _uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_role
from app.core.security import hash_password
from app.core.sms import send_doctor_credentials
from app.core.username import generate_username
from app.db.engine import get_session
from app.models.public.user import Tenant, User

router = APIRouter()

# Roles that hospital_admin can create/manage (doctors go via /doctors/onboard)
MANAGEABLE_ROLES = {"receptionist", "nurse", "billing_officer", "hospital_admin", "lab_technician", "pharmacist"}


class UserCreate(BaseModel):
    email: EmailStr
    phone: str = Field(..., pattern=r"^\+?[1-9]\d{9,14}$")
    password: str = Field(..., min_length=8)
    username: Optional[str] = Field(
        None, min_length=3, max_length=50, pattern=r"^[a-z0-9_]+$"
    )
    full_name: str = Field(..., min_length=1, max_length=255)
    role: str

    @field_validator("role")
    @classmethod
    def role_must_be_manageable(cls, v: str) -> str:
        if v not in MANAGEABLE_ROLES:
            raise ValueError(f"Role must be one of: {', '.join(sorted(MANAGEABLE_ROLES))}")
        return v

    @field_validator("username", mode="before")
    @classmethod
    def empty_str_to_none(cls, v: object) -> object:
        if isinstance(v, str) and v.strip() == "":
            return None
        return v


class UserUpdate(BaseModel):
    full_name: Optional[str] = Field(None, min_length=1, max_length=255)
    is_active: Optional[bool] = None


def _row_to_dict(r: User) -> dict:
    return {
        "id": str(r.id),
        "full_name": r.full_name,
        "email": r.email,
        "username": r.username,
        "phone": r.phone,
        "role": r.role,
        "is_active": r.is_active,
        "tenant_name": r.tenant_name,
    }


@router.get("", response_model=List[dict])
async def list_users(
    role: Optional[str] = None,
    include_inactive: bool = False,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role("hospital_admin", "super_admin")),
):
    """Returns all non-doctor users belonging to the caller's tenant."""
    tenant_schema: str = current_user.get("tenant_schema", "")
    tenant = (await session.execute(
        select(Tenant).where(Tenant.schema_name == tenant_schema)
    )).scalar_one_or_none()
    if not tenant:
        return []

    stmt = (
        select(User)
        .where(User.tenant_id == tenant.id, User.role != "doctor")
        .order_by(User.full_name)
    )
    if not include_inactive:
        stmt = stmt.where(User.is_active == True)  # noqa: E712
    if role:
        stmt = stmt.where(User.role == role)

    rows = (await session.execute(stmt)).scalars().all()
    return [_row_to_dict(r) for r in rows]


@router.post("", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role("hospital_admin")),
):
    """Create a new staff user (non-doctor). Sends credentials via SMS."""
    tenant_schema: str = current_user.get("tenant_schema", "")
    tenant = (await session.execute(
        select(Tenant).where(Tenant.schema_name == tenant_schema)
    )).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant not found")

    if (await session.execute(select(User).where(User.email == payload.email))).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="A user with this email already exists")

    username = payload.username or await generate_username(payload.full_name, session)
    if payload.username:
        if (await session.execute(select(User).where(User.username == username))).scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f"Username '{username}' is already taken")

    new_user = User(
        id=_uuid.uuid4(),
        tenant_id=tenant.id,
        tenant_name=tenant_schema,
        email=payload.email,
        username=username,
        phone=payload.phone,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
        role=payload.role,
    )
    session.add(new_user)
    await session.commit()

    send_doctor_credentials(
        to_phone=payload.phone,
        full_name=payload.full_name,
        username=username,
        password=payload.password,
        hospital_name=tenant.hospital_name,
    )

    return _row_to_dict(new_user)


@router.patch("/{user_id}", response_model=dict)
async def update_user(
    user_id: _uuid.UUID,
    payload: UserUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role("hospital_admin")),
):
    """Update a staff user's name or active status."""
    tenant_schema: str = current_user.get("tenant_schema", "")
    tenant = (await session.execute(
        select(Tenant).where(Tenant.schema_name == tenant_schema)
    )).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant not found")

    user = (await session.execute(
        select(User).where(User.id == user_id, User.tenant_id == tenant.id)
    )).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == "doctor":
        raise HTTPException(status_code=400, detail="Use /doctors endpoints to manage doctors")

    if payload.full_name is not None:
        user.full_name = payload.full_name
    if payload.is_active is not None:
        user.is_active = payload.is_active

    await session.commit()
    return _row_to_dict(user)
