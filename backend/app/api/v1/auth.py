from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.engine import get_session
from app.core.security import verify_password, create_access_token, create_refresh_token, decode_token
from app.models.public.user import User, Tenant
from app.schemas.auth import LoginRequest, TokenResponse, RefreshRequest

router = APIRouter()


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, session: AsyncSession = Depends(get_session)):
    # Always query public schema for auth
    result = await session.execute(
        select(User).where(User.email == payload.email, User.is_active == True)  # noqa: E712
    )
    user = result.scalar_one_or_none()

    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    # Fetch tenant schema
    tenant_result = await session.execute(
        select(Tenant).where(Tenant.id == user.tenant_id)
    )
    tenant = tenant_result.scalar_one_or_none()
    if not tenant or not tenant.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Hospital account is inactive",
        )

    extra_claims = {
        "role": user.role,
        "tenant_schema": tenant.schema_name,
        "full_name": user.full_name,
    }
    access_token = create_access_token(subject=str(user.id), extra_claims=extra_claims)
    refresh_token = create_refresh_token(subject=str(user.id))

    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(payload: RefreshRequest, session: AsyncSession = Depends(get_session)):
    from jose import JWTError
    try:
        token_data = decode_token(payload.refresh_token)
        if token_data.get("type") != "refresh":
            raise ValueError
    except (JWTError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    result = await session.execute(
        select(User).where(User.id == token_data["sub"], User.is_active == True)  # noqa: E712
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    tenant_result = await session.execute(select(Tenant).where(Tenant.id == user.tenant_id))
    tenant = tenant_result.scalar_one_or_none()

    extra_claims = {"role": user.role, "tenant_schema": tenant.schema_name, "full_name": user.full_name}
    access_token = create_access_token(subject=str(user.id), extra_claims=extra_claims)
    new_refresh = create_refresh_token(subject=str(user.id))
    return TokenResponse(access_token=access_token, refresh_token=new_refresh)
