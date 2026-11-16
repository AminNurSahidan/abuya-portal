import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Role = Literal["SM", "AM", "AMKA", "PIC", "Master"]
PRStatus = Literal["Pending", "Approved", "Rejected", "Expired"]
Shipping = Literal["Direct", "Indirect"]

Password = Field(min_length=6, max_length=72)
USERNAME_PATTERN = r"^[a-z0-9._-]{3,50}$"


def normalize_username(value: str) -> str:
    value = (value or "").strip()
    if "@" in value:
        value = value.split("@", 1)[0]
    return value


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class BrandOut(ORM):
    id: int
    code: str
    name: str
    direct_only: bool


class BranchOut(ORM):
    id: int
    code: str
    name: str
    brand: BrandOut | None = None


class BranchIn(BaseModel):
    code: str = Field(min_length=1, max_length=30)
    name: str = Field(min_length=2, max_length=150)
    brand_id: int


class BranchUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=30)
    name: str | None = Field(default=None, min_length=2, max_length=150)
    brand_id: int | None = None


class ProductOut(ORM):
    id: int
    name: str
    unit: str | None
    display_name: str
    brand: BrandOut | None = None


class ProductIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    unit: str | None = Field(default=None, max_length=30)
    brand_id: int | None = None


class ProductUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    unit: str | None = Field(default=None, max_length=30)
    brand_id: int | None = None
    clear_brand: bool = False


class PicOut(ORM):
    id: int
    name: str
    shipping: Shipping | None
    brand: BrandOut | None = None


class PicIn(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    shipping: Shipping
    brand_id: int | None = None


class PicUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    shipping: Shipping | None = None
    brand_id: int | None = None
    clear_brand: bool = False


class BulkDelete(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=500)


class UserOut(ORM):
    id: uuid.UUID
    username: str
    role: Role
    brand: BrandOut | None = None
    is_active: bool
    last_login_at: datetime | None
    created_at: datetime
    branches: list[BranchOut] = []


class UserCreate(BaseModel):
    username: str = Field(pattern=USERNAME_PATTERN)
    password: str = Password
    role: Role
    brand_id: int | None = None

    @field_validator("username", mode="before")
    @classmethod
    def clean_username(cls, v: str) -> str:
        return normalize_username(v)


class UserUpdate(BaseModel):
    role: Role | None = None
    brand_id: int | None = None
    is_active: bool | None = None


class UserBulkDelete(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class MappingUpdate(BaseModel):
    branch_ids: list[int] = Field(max_length=1000)


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=72)
    remember: bool = False


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: UserOut


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


class ItemIn(BaseModel):
    product_id: int
    qty: int = Field(ge=1, le=1_000_000)


class ItemQty(BaseModel):
    qty: int = Field(ge=1, le=1_000_000)


class ItemOut(ORM):
    id: int
    product_id: int | None
    item_name: str
    qty: int


class POMini(ORM):
    id: int
    number: str
    created_at: datetime


class PRIn(BaseModel):
    branch_id: int
    required_date: date
    shipping_category: Shipping
    pic: str = Field(min_length=1, max_length=150)
    notes: str | None = Field(default=None, max_length=2000)
    items: list[ItemIn] = Field(min_length=1, max_length=200)
    approve_now: bool = False


class PROut(ORM):
    id: int
    number: str
    branch: BranchOut
    brand: BrandOut | None = None
    shipping_category: str
    pic: str | None
    required_date: date | None
    notes: str | None
    status: PRStatus
    created_by: str | None
    created_at: datetime
    updated_by: str | None
    updated_at: datetime | None
    item_count: int = 0
    po: POMini | None = None


class PRDetail(PROut):
    items: list[ItemOut] = []
    can_edit: bool = False
    can_approve_now: bool = False


class PRList(BaseModel):
    items: list[PROut]
    total: int
    page: int
    size: int


class PRMini(ORM):
    id: int
    number: str
    branch: BranchOut
    shipping_category: str
    pic: str | None
    required_date: date | None
    notes: str | None


class POOut(ORM):
    id: int
    number: str
    created_by: str | None
    created_at: datetime
    pr: PRMini


class PODetail(POOut):
    items: list[ItemOut] = []


class POList(BaseModel):
    items: list[POOut]
    total: int
    page: int
    size: int


class StageBranch(BaseModel):
    branch: BranchOut
    count: int


class StageSummary(BaseModel):
    total: int
    by_key: dict[str, int]
    branches: list[StageBranch]


class ExportRow(BaseModel):
    purchase_date: datetime
    required_date: date | None
    po_number: str
    pr_number: str
    branch: str
    product_name: str
    unit: str
    qty: int | None
    shipping: str
    pic: str
    notes: str
    created_by: str


class TopItem(BaseModel):
    item_name: str
    value: int


class ExpiringPR(BaseModel):
    id: int
    number: str
    branch: str


class DashboardSummary(BaseModel):
    status_counts: dict[str, int]
    total: int
    expiring: list[ExpiringPR]
    top_by_po: list[TopItem]
    top_by_qty: list[TopItem]
    activity: list[ActivityOut]
    branches: list[BranchOut]


class PRFormOptions(BaseModel):
    branches: list[BranchOut]
    products: list[ProductOut]
    pics: list[PicOut]
    can_create: bool
    can_approve_now: bool