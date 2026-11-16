import uuid
from datetime import date, datetime, timezone

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

ROLES = ("SM", "AM", "AMKA", "PIC", "Master")
BRANCH_SCOPED_ROLES = ("SM", "AM", "AMKA")
PR_STATUSES = ("Pending", "Approved", "Rejected", "Expired")
SHIPPING_CATEGORIES = ("Direct", "Indirect")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


class Brand(Base):
    __tablename__ = "brands"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    direct_only: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Branch(Base):
    __tablename__ = "branches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(30), unique=True)
    name: Mapped[str] = mapped_column(String(150), unique=True)
    brand_id: Mapped[int | None] = mapped_column(ForeignKey("brands.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    brand: Mapped[Brand | None] = relationship(lazy="selectin")


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (UniqueConstraint("name", "unit", name="uq_products_name_unit"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    unit: Mapped[str | None] = mapped_column(String(30), nullable=True)
    brand_id: Mapped[int | None] = mapped_column(ForeignKey("brands.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    brand: Mapped[Brand | None] = relationship(lazy="selectin")

    @property
    def display_name(self) -> str:
        return f"{self.name} ({self.unit})" if self.unit else self.name


class Pic(Base):
    __tablename__ = "pics"
    __table_args__ = (UniqueConstraint("name", "shipping", "brand_id", name="uq_pics_name_shipping_brand"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(150))
    shipping: Mapped[str | None] = mapped_column(String(20), nullable=True)
    brand_id: Mapped[int | None] = mapped_column(ForeignKey("brands.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    brand: Mapped[Brand | None] = relationship(lazy="selectin")


class UserBranch(Base):
    __tablename__ = "user_branches"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"), primary_key=True)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="SM", index=True)
    brand_id: Mapped[int | None] = mapped_column(ForeignKey("brands.id", ondelete="SET NULL"), nullable=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    brand: Mapped[Brand | None] = relationship(lazy="selectin")
    branches: Mapped[list[Branch]] = relationship(secondary="user_branches", lazy="selectin", order_by=Branch.name)

    @property
    def is_branch_scoped(self) -> bool:
        return self.role in BRANCH_SCOPED_ROLES


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    actor_name: Mapped[str] = mapped_column(String(150))
    module: Mapped[str] = mapped_column(String(30), index=True)
    action: Mapped[str] = mapped_column(String(50))
    description: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class DocumentCounter(Base):
    __tablename__ = "document_number_counters"

    doc_date: Mapped[date] = mapped_column(Date, primary_key=True)
    prefix: Mapped[str] = mapped_column(String(10), primary_key=True)
    last_seq: Mapped[int] = mapped_column(Integer, default=0)


class PurchaseRequest(Base):
    __tablename__ = "purchase_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    number: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branches.id", ondelete="RESTRICT"), index=True)
    brand_id: Mapped[int | None] = mapped_column(ForeignKey("brands.id", ondelete="SET NULL"), nullable=True, index=True)
    shipping_category: Mapped[str] = mapped_column(String(20))
    pic: Mapped[str | None] = mapped_column(String(150), nullable=True)
    required_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="Pending", index=True)
    created_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    updated_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    branch: Mapped[Branch] = relationship(lazy="selectin")
    brand: Mapped[Brand | None] = relationship(lazy="selectin")
    items: Mapped[list["PurchaseRequestItem"]] = relationship(
        back_populates="pr", lazy="selectin", cascade="all, delete-orphan", order_by="PurchaseRequestItem.id"
    )
    po: Mapped["PurchaseOrder | None"] = relationship(back_populates="pr", lazy="selectin", uselist=False)

    @property
    def item_count(self) -> int:
        return len(self.items)


class PurchaseRequestItem(Base):
    __tablename__ = "purchase_request_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pr_id: Mapped[int] = mapped_column(ForeignKey("purchase_requests.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id", ondelete="SET NULL"), nullable=True)
    item_name: Mapped[str] = mapped_column(String(250))
    qty: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    pr: Mapped[PurchaseRequest] = relationship(back_populates="items")
    product: Mapped[Product | None] = relationship(lazy="selectin")


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    number: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    pr_id: Mapped[int] = mapped_column(ForeignKey("purchase_requests.id", ondelete="RESTRICT"), unique=True)
    created_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    pr: Mapped[PurchaseRequest] = relationship(back_populates="po", lazy="selectin")