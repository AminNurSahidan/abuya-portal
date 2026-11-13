import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

Role = Literal["admin", "am", "amka", "approver", "gudang", "staff"]

Password = Field(min_length=8, max_length=72)


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class BrandOut(ORM):
    id: int
    code: str
    name: str
    is_active: bool


class BrandCreate(BaseModel):
    code: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=2, max_length=100)


class BrandUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=20)
    name: str | None = Field(default=None, min_length=2, max_length=100)
    is_active: bool | None = None


class BranchOut(ORM):
    id: int
    code: str
    name: str
    is_active: bool
    brand: BrandOut | None = None


class BranchCreate(BaseModel):
    brand_id: int
    code: str = Field(min_length=1, max_length=30)
    name: str = Field(min_length=2, max_length=150)


class BranchUpdate(BaseModel):
    brand_id: int | None = None
    code: str | None = Field(default=None, min_length=1, max_length=30)
    name: str | None = Field(default=None, min_length=2, max_length=150)
    is_active: bool | None = None


class UserOut(ORM):
    id: uuid.UUID
    email: str
    full_name: str
    role: Role
    is_active: bool
    last_login_at: datetime | None
    created_at: datetime
    branches: list[BranchOut] = []


class UserList(BaseModel):
    items: list[UserOut]
    total: int
    page: int
    size: int


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=150)
    role: Role = "staff"
    password: str = Password
    branch_ids: list[int] = []

    @field_validator("email")
    @classmethod
    def lower_email(cls, v: str) -> str:
        return v.lower()


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=150)
    role: Role | None = None
    is_active: bool | None = None
    branch_ids: list[int] | None = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=72)
    remember: bool = False


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: UserOut


class ProfileUpdate(BaseModel):
    full_name: str = Field(min_length=2, max_length=150)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=72)
    new_password: str = Password


class PasswordReset(BaseModel):
    new_password: str = Password


class ActivityOut(ORM):
    id: int
    actor_name: str
    module: str
    action: str
    description: str
    created_at: datetime


class DashboardStats(BaseModel):
    pending_pr: int | None = None
    po_this_month: int | None = None
    low_stock: int | None = None
    opname_running: int | None = None


class DashboardSummary(BaseModel):
    stats: DashboardStats
    activity: list[ActivityOut]
    branches: list[BranchOut]
