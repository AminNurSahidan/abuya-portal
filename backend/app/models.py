import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    JSON,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

MASTER_ROLE = "Master"
PERMISSIONS = {
    "pr.view": "Lihat Purchase Request",
    "pr.create": "Buat Purchase Request",
    "pr.update": "Edit item PR",
    "pr.approve": "Approve PR",
    "pr.approve_now": "Auto Approve saat buat PR",
    "pr.reject": "Tolak PR",
    "po.view": "Lihat Purchase Order",
    "po.export": "Export Purchase Order",
    "branch.all": "Lihat semua cabang brand tanpa mapping",
    "log.view": "Lihat Log",
    "wh.session.view": "Lihat sesi stock opname",
    "wh.session.create": "Buat sesi stock opname",
    "wh.session.update": "Edit & tutup sesi stock opname",
    "wh.session.delete": "Hapus sesi stock opname",
    "wh.count.input": "Input hitung stock opname",
    "wh.final.approve": "Finalisasi hasil stock opname",
    "wh.structure.view": "Lihat struktur gudang",
    "wh.structure.create": "Tambah zona/sector & atur produk sector",
    "wh.structure.update": "Edit zona/sector",
    "wh.structure.delete": "Hapus zona/sector",
    "wh.product.view": "Lihat produk gudang",
    "wh.product.create": "Tambah produk gudang",
    "wh.product.update": "Edit & aktif/nonaktif produk gudang",
    "wh.product.delete": "Hapus produk gudang",
    "wh.data.import": "Import data gudang",
    "wh.data.export": "Export & cetak data gudang",
}
PERMISSION_COLUMNS = [
    ("view", "Lihat"),
    ("create", "Buat"),
    ("update", "Edit"),
    ("delete", "Hapus"),
    ("approve", "Approve"),
    ("approve_now", "Auto Approve"),
    ("reject", "Tolak"),
    ("export", "Export"),
]
PERMISSION_GRID = [
    ("Purchasing", [
        ("Purchase Request", {"view": "pr.view", "create": "pr.create", "update": "pr.update", "approve": "pr.approve", "approve_now": "pr.approve_now", "reject": "pr.reject"}),
        ("Purchase Order", {"view": "po.view", "export": "po.export"}),
    ]),
    ("Akses Cabang", [
        ("Semua cabang brand (tanpa mapping)", {"view": "branch.all"}),
    ]),
    ("Log", [
        ("Log Aktivitas", {"view": "log.view"}),
    ]),
    ("ABWarehouse", [
        ("Sesi Stock Opname", {"view": "wh.session.view", "create": "wh.session.create", "update": "wh.session.update", "delete": "wh.session.delete"}),
        ("Input Hitung", {"create": "wh.count.input"}),
        ("Review & Finalisasi", {"approve": "wh.final.approve"}),
        ("Struktur Gudang (Zona & Sector)", {"view": "wh.structure.view", "create": "wh.structure.create", "update": "wh.structure.update", "delete": "wh.structure.delete"}),
        ("Produk Gudang", {"view": "wh.product.view", "create": "wh.product.create", "update": "wh.product.update", "delete": "wh.product.delete"}),
        ("Import Data Gudang", {"create": "wh.data.import"}),
        ("Export & Cetak", {"export": "wh.data.export"}),
    ]),
]
WH_BRAND_CODE = "DC"
WH_SESSION_STATUSES = ("Aktif", "Selesai", "Final")
OLD_PERMISSION_KEYS = {
    "create_pr": "pr.create",
    "approve_on_create": "pr.approve_now",
    "approve_pr": "pr.approve",
    "reject_pr": "pr.reject",
    "edit_pr_items": "pr.update",
    "view_all_branches": "branch.all",
    "export_po": "po.export",
}
LOG_MODULES = {
    "approval": "Approval",
    "warehouse": "ABWarehouse",
    "master": "Data Master",
    "users": "User",
    "roles": "Role",
    "auth": "Login",
}
BRAND_LOG_MODULES = ("approval", "warehouse")
DEFAULT_ROLES = [
    ("SM", ["pr.view", "pr.create", "po.view", "log.view"]),
    ("AM", ["pr.view", "pr.update", "pr.approve", "pr.reject", "po.view", "log.view"]),
    ("AMKA", ["pr.view", "pr.create", "pr.update", "pr.approve", "pr.approve_now", "po.view", "log.view"]),
    ("PIC", ["pr.view", "po.view", "po.export", "branch.all", "log.view"]),
    (MASTER_ROLE, list(PERMISSIONS)),
]
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
    wh_code: Mapped[str | None] = mapped_column(String(1), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    brand: Mapped[Brand | None] = relationship(lazy="selectin")


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (UniqueConstraint("name", "unit", "brand_id", name="uq_products_name_unit_brand"),)

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


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True)
    brand_id: Mapped[int | None] = mapped_column(ForeignKey("brands.id", ondelete="SET NULL"), nullable=True, index=True)
    permissions: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    brand: Mapped[Brand | None] = relationship(lazy="selectin")

    @property
    def is_locked(self) -> bool:
        return self.name == MASTER_ROLE

    @property
    def perms(self) -> list[str]:
        if self.is_locked:
            return list(PERMISSIONS)
        return [p for p in PERMISSIONS if p in (self.permissions or [])]


class UserBranch(Base):
    __tablename__ = "user_branches"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"), primary_key=True)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(50), default="SM", index=True)
    brand_id: Mapped[int | None] = mapped_column(ForeignKey("brands.id", ondelete="SET NULL"), nullable=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    session_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    session_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    session_device: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    brand: Mapped[Brand | None] = relationship(lazy="selectin")
    branches: Mapped[list[Branch]] = relationship(secondary="user_branches", lazy="selectin", order_by=Branch.name)

    role_ref: Mapped[Role | None] = relationship(primaryjoin="foreign(User.role) == Role.name", viewonly=True, lazy="selectin")

    @property
    def session_active(self) -> bool:
        from app.config import settings

        seen = as_utc(self.session_seen_at)
        return bool(self.session_token) and seen is not None and utcnow() - seen < timedelta(minutes=settings.session_idle_minutes)

    @property
    def is_master(self) -> bool:
        return self.role == MASTER_ROLE

    @property
    def permissions(self) -> list[str]:
        if self.is_master:
            return list(PERMISSIONS)
        return self.role_ref.perms if self.role_ref else []

    def can(self, perm: str) -> bool:
        return perm in self.permissions

    @property
    def is_branch_scoped(self) -> bool:
        return not self.is_master and not self.can("branch.all")


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    actor_name: Mapped[str] = mapped_column(String(150))
    module: Mapped[str] = mapped_column(String(30), index=True)
    action: Mapped[str] = mapped_column(String(50))
    description: Mapped[str] = mapped_column(Text)
    brand_id: Mapped[int | None] = mapped_column(ForeignKey("brands.id", ondelete="SET NULL"), nullable=True, index=True)
    ref: Mapped[str | None] = mapped_column(String(60), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    brand: Mapped[Brand | None] = relationship(lazy="selectin")


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[str] = mapped_column(String(200))


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


class WhZone(Base):
    __tablename__ = "wh_zones"
    __table_args__ = (UniqueConstraint("branch_id", "name", name="uq_wh_zones_branch_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    sectors: Mapped[list["WhSector"]] = relationship(back_populates="zone", lazy="selectin", order_by="WhSector.name", cascade="all, delete-orphan")


class WhSector(Base):
    __tablename__ = "wh_sectors"
    __table_args__ = (UniqueConstraint("zone_id", "name", name="uq_wh_sectors_zone_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    zone_id: Mapped[int] = mapped_column(ForeignKey("wh_zones.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    zone: Mapped[WhZone] = relationship(back_populates="sectors")


class WhProduct(Base):
    __tablename__ = "wh_products"

    barcode: Mapped[str] = mapped_column(String(60), primary_key=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id", ondelete="SET NULL"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    product_code: Mapped[str | None] = mapped_column(String(60), nullable=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    sub_category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    unit: Mapped[str | None] = mapped_column(String(30), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    branch: Mapped[Branch | None] = relationship(lazy="selectin")


class WhPlacement(Base):
    __tablename__ = "wh_placements"
    __table_args__ = (UniqueConstraint("sector_id", "barcode", name="uq_wh_placements_sector_barcode"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sector_id: Mapped[int] = mapped_column(ForeignKey("wh_sectors.id", ondelete="CASCADE"), index=True)
    barcode: Mapped[str] = mapped_column(ForeignKey("wh_products.barcode", ondelete="CASCADE"), index=True)
    sequence: Mapped[int] = mapped_column(Integer, default=0)

    product: Mapped[WhProduct] = relationship(lazy="selectin")


class WhSession(Base):
    __tablename__ = "wh_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(150))
    session_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="Aktif", index=True)
    created_by: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finalized_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    branch: Mapped[Branch] = relationship(lazy="selectin")


class WhCount(Base):
    __tablename__ = "wh_counts"
    __table_args__ = (UniqueConstraint("session_id", "sector_id", "barcode", name="uq_wh_counts_session_sector_barcode"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("wh_sessions.id", ondelete="CASCADE"), index=True)
    sector_id: Mapped[int] = mapped_column(ForeignKey("wh_sectors.id", ondelete="RESTRICT"), index=True)
    barcode: Mapped[str] = mapped_column(ForeignKey("wh_products.barcode", ondelete="RESTRICT"), index=True)
    qty: Mapped[float] = mapped_column(Numeric(14, 3))
    note: Mapped[str | None] = mapped_column(String(300), nullable=True)
    updated_by: Mapped[str] = mapped_column(String(100))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, index=True)


class WhFinal(Base):
    __tablename__ = "wh_finals"
    __table_args__ = (UniqueConstraint("session_id", "barcode", name="uq_wh_finals_session_barcode"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("wh_sessions.id", ondelete="CASCADE"), index=True)
    barcode: Mapped[str] = mapped_column(ForeignKey("wh_products.barcode", ondelete="RESTRICT"), index=True)
    qty_count: Mapped[float] = mapped_column(Numeric(14, 3))
    qty_final: Mapped[float] = mapped_column(Numeric(14, 3))
    note: Mapped[str | None] = mapped_column(String(300), nullable=True)