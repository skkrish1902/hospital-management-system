from pydantic import BaseModel


class LoginRequest(BaseModel):
    login_id: str   # accepts email OR username
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class UserPublic(BaseModel):
    id: str
    email: str
    full_name: str
    role: str
    tenant_schema: str
