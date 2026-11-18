from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas import BulkSkip


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


SessionStatus = Literal["Aktif", "Selesai", "Final"]


class DcOut(BaseModel):
    id: int
    code: str
    name: str
    wh_code: str | None
    zones: int = 0
    sectors: int = 0
    products: int = 0
    placements: int = 0
    active_sessions: int = 0
    last_session: dict | None = None


class SectorOut(BaseModel):
    id: int
    name: str
    products: int = 0


class ZoneOut(BaseModel):
    id: int
    name: str
    sectors: list[SectorOut] = []


class ZoneIn(BaseModel):
    branch_id: int
    name: str = Field(min_length=1, max_length=100)


class NameIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class SectorIn(BaseModel):
    zone_id: int
    name: str = Field(min_length=1, max_length=100)


class IdList(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=5000)


class BarcodeList(BaseModel):
    barcodes: list[str] = Field(min_length=1, max_length=5000)


class StatusChange(BarcodeList):
    active: bool


class PlacementOut(BaseModel):
    id: int
    barcode: str
    name: str
    unit: str | None
    product_code: str | None
    category: str | None
    is_active: bool
    sequence: int


class AddResult(BaseModel):
    added: int
    skipped: list[BulkSkip] = []


class WhProductOut(BaseModel):
    barcode: str
    name: str
    product_code: str | None
    category: str | None
    sub_category: str | None
    unit: str | None
    is_active: bool
    deactivated_at: datetime | None
    created_at: datetime
    dc: dict | None = None
    placements: list[str] = []


class WhProductList(BaseModel):
    items: list[WhProductOut]
    total: int
    page: int
    size: int
    counts: dict[str, int]


class WhProductIn(BaseModel):
    barcode: str = Field(min_length=2, max_length=60)
    name: str = Field(min_length=1, max_length=200)
    product_code: str | None = Field(default=None, max_length=60)
    category: str | None = Field(default=None, max_length=100)
    sub_category: str | None = Field(default=None, max_length=100)
    unit: str | None = Field(default=None, max_length=30)


class WhProductUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    product_code: str | None = Field(default=None, max_length=60)
    category: str | None = Field(default=None, max_length=100)
    sub_category: str | None = Field(default=None, max_length=100)
    unit: str | None = Field(default=None, max_length=30)


class ProductOption(BaseModel):
    barcode: str
    name: str
    unit: str | None
    category: str | None
    placed: bool = False


class ImportRow(BaseModel):
    row: int
    dc: str = Field(default="", max_length=150)
    zone: str = Field(default="", max_length=100)
    sector: str = Field(default="", max_length=100)
    barcode: str = Field(default="", max_length=60)
    name: str = Field(default="", max_length=200)
    product_code: str = Field(default="", max_length=60)
    category: str = Field(default="", max_length=100)
    sub_category: str = Field(default="", max_length=100)
    unit: str = Field(default="", max_length=30)
    status: str = Field(default="", max_length=30)


class ImportIn(BaseModel):
    rows: list[ImportRow] = Field(min_length=1, max_length=10000)
    update_existing: bool = False


class ImportResult(BaseModel):
    products_added: int = 0
    products_updated: int = 0
    zones_added: int = 0
    sectors_added: int = 0
    placements_added: int = 0
    skipped: list[BulkSkip] = []


class ExportRow(BaseModel):
    dc: str
    zone: str
    sector: str
    barcode: str
    name: str
    product_code: str
    category: str
    sub_category: str
    unit: str
    status: str


class SessionIn(BaseModel):
    branch_id: int
    name: str = Field(min_length=2, max_length=150)
    session_date: date


class SessionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=150)
    session_date: date | None = None


class SessionStatusIn(BaseModel):
    status: Literal["Aktif", "Selesai"]


class Progress(BaseModel):
    counted: int = 0
    total: int = 0


class SessionOut(BaseModel):
    id: int
    name: str
    session_date: date
    status: str
    created_by: str
    created_at: datetime
    finalized_by: str | None
    finalized_at: datetime | None
    dc: dict
    progress: Progress


class SessionList(BaseModel):
    items: list[SessionOut]
    total: int
    page: int
    size: int
    counts: dict[str, int]


class SectorProgress(BaseModel):
    id: int
    name: str
    counted: int
    total: int


class ZoneProgress(BaseModel):
    id: int
    name: str
    counted: int
    total: int
    sectors: list[SectorProgress]


class SessionDetail(SessionOut):
    zones: list[ZoneProgress]
    last_count_at: datetime | None
    can: dict[str, bool]


class CountRow(BaseModel):
    zone_id: int
    zone: str
    sector_id: int
    sector: str
    barcode: str
    name: str
    unit: str | None
    product_code: str | None
    is_active: bool
    sequence: int
    qty: float | None = None
    note: str | None = None
    updated_by: str | None = None
    updated_at: datetime | None = None


class CountRowList(BaseModel):
    items: list[CountRow]
    total: int
    page: int
    size: int


class CountIn(BaseModel):
    sector_id: int
    barcode: str = Field(min_length=1, max_length=60)
    qty: float | None = Field(default=None, ge=0, le=99999999)
    note: str | None = Field(default=None, max_length=300)


class ReviewRow(BaseModel):
    barcode: str
    name: str
    unit: str | None
    sectors: str
    qty_count: float
    qty_final: float | None = None
    note: str | None = None


class ReviewOut(BaseModel):
    items: list[ReviewRow]
    uncounted: int
    final: bool


class FinalItem(BaseModel):
    barcode: str = Field(min_length=1, max_length=60)
    qty_final: float = Field(ge=0, le=99999999)
    note: str | None = Field(default=None, max_length=300)


class FinalizeIn(BaseModel):
    items: list[FinalItem] = Field(default=[], max_length=20000)