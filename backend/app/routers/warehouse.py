from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import case, delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.activity import log_activity
from app.database import get_db
from app.deps import get_current_user
from app.models import (
    WH_BRAND_CODE,
    Branch,
    Brand,
    User,
    WhCount,
    WhFinal,
    WhPlacement,
    WhProduct,
    WhSector,
    WhSession,
    WhZone,
    utcnow,
)
from app.schemas import BulkSkip
from app.schemas_wh import (
    AddResult,
    BarcodeList,
    CountIn,
    CountRow,
    CountRowList,
    DcOut,
    ExportRow,
    FinalizeIn,
    IdList,
    ImportIn,
    ImportResult,
    NameIn,
    PlacementOut,
    ProductOption,
    Progress,
    ReviewOut,
    ReviewRow,
    SectorIn,
    SectorOut,
    SectorProgress,
    SessionDetail,
    SessionIn,
    SessionList,
    SessionOut,
    SessionStatusIn,
    SessionUpdate,
    StatusChange,
    WhProductIn,
    WhProductList,
    WhProductOut,
    WhProductUpdate,
    ZoneIn,
    ZoneOut,
    ZoneProgress,
)
from app.scope import accessible_branches

router = APIRouter(prefix="/api/wh", tags=["warehouse"])

VIEW_ANY = ("wh.session.view", "wh.structure.view", "wh.product.view", "wh.count.input")


def forbidden(detail: str = "Role kamu tidak punya akses untuk fitur ini.") -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def bad(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def not_found(label: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{label} tidak ditemukan.")


def need(user: User, *perms: str) -> None:
    if not any(user.can(p) for p in perms):
        raise forbidden()


def clean(v: str | None) -> str | None:
    if v is None:
        return None
    v = " ".join(v.split())
    return v or None


def num(v) -> float | None:
    return None if v is None else float(v)


def dc_list(db: Session, user: User) -> list[Branch]:
    return [b for b in accessible_branches(db, user, None) if b.brand and b.brand.code == WH_BRAND_CODE]


def dc_ids(db: Session, user: User) -> list[int]:
    return [b.id for b in dc_list(db, user)]


def get_dc(db: Session, user: User, branch_id: int) -> Branch:
    dc = db.get(Branch, branch_id)
    if dc is None or not dc.brand or dc.brand.code != WH_BRAND_CODE:
        raise not_found("DC")
    if dc.id not in dc_ids(db, user):
        raise forbidden("Kamu tidak punya akses ke DC ini.")
    return dc


def dc_ref(dc: Branch | None) -> dict | None:
    if dc is None:
        return None
    return {"id": dc.id, "code": dc.code, "name": dc.name, "wh_code": dc.wh_code}


def log_wh(db: Session, user: User, action: str, description: str, dc: Branch | None = None, ref: str | None = None) -> None:
    brand_id = dc.brand_id if dc else db.scalar(select(Brand.id).where(Brand.code == WH_BRAND_CODE))
    log_activity(db, user, "warehouse", action, description, brand_id=brand_id, ref=ref)


def commit_or_conflict(db: Session, message: str) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message)


def get_zone(db: Session, user: User, zone_id: int) -> tuple[WhZone, Branch]:
    zone = db.get(WhZone, zone_id)
    if zone is None:
        raise not_found("Zona")
    return zone, get_dc(db, user, zone.branch_id)


def get_sector(db: Session, user: User, sector_id: int) -> tuple[WhSector, Branch]:
    sector = db.get(WhSector, sector_id)
    if sector is None:
        raise not_found("Sector")
    return sector, get_dc(db, user, sector.zone.branch_id)


def dc_for_barcode(db: Session, barcode: str) -> Branch | None:
    letter = barcode[:1].upper()
    if not letter.isalpha():
        return None
    return db.scalar(select(Branch).join(Brand).where(Branch.wh_code == letter, Brand.code == WH_BRAND_CODE))


def barcode_rule(db: Session) -> str:
    rows = db.execute(
        select(Branch.wh_code, Branch.name).join(Brand).where(Brand.code == WH_BRAND_CODE, Branch.wh_code.is_not(None)).order_by(Branch.wh_code)
    ).all()
    return ", ".join(f"{c} = {n}" for c, n in rows) or "belum ada DC yang punya kode barcode"


def placement_counts(db: Session, sector_ids: list[int]) -> dict[int, int]:
    if not sector_ids:
        return {}
    rows = db.execute(
        select(WhPlacement.sector_id, func.count())
        .join(WhProduct, WhProduct.barcode == WhPlacement.barcode)
        .where(WhPlacement.sector_id.in_(sector_ids), WhProduct.is_active.is_(True))
        .group_by(WhPlacement.sector_id)
    ).all()
    return dict(rows)


@router.get("/dcs", response_model=list[DcOut])
def list_dcs(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    need(user, *VIEW_ANY)
    out = []
    for dc in dc_list(db, user):
        zone_ids = list(db.scalars(select(WhZone.id).where(WhZone.branch_id == dc.id)))
        sector_ids = list(db.scalars(select(WhSector.id).where(WhSector.zone_id.in_(zone_ids or [-1]))))
        last = db.scalar(select(WhSession).where(WhSession.branch_id == dc.id).order_by(WhSession.session_date.desc(), WhSession.id.desc()).limit(1))
        out.append(
            DcOut(
                id=dc.id,
                code=dc.code,
                name=dc.name,
                wh_code=dc.wh_code,
                zones=len(zone_ids),
                sectors=len(sector_ids),
                products=db.scalar(select(func.count()).select_from(WhProduct).where(WhProduct.branch_id == dc.id, WhProduct.is_active.is_(True))) or 0,
                placements=sum(placement_counts(db, sector_ids).values()),
                active_sessions=db.scalar(select(func.count()).select_from(WhSession).where(WhSession.branch_id == dc.id, WhSession.status == "Aktif")) or 0,
                last_session={"id": last.id, "name": last.name, "date": last.session_date.isoformat(), "status": last.status} if last else None,
            )
        )
    return out


@router.get("/dcs/{branch_id}/zones", response_model=list[ZoneOut])
def list_zones(branch_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    need(user, *VIEW_ANY)
    dc = get_dc(db, user, branch_id)
    zones = list(db.scalars(select(WhZone).where(WhZone.branch_id == dc.id).order_by(WhZone.name)))
    counts = placement_counts(db, [s.id for z in zones for s in z.sectors])
    return [
        ZoneOut(id=z.id, name=z.name, sectors=[SectorOut(id=s.id, name=s.name, products=counts.get(s.id, 0)) for s in z.sectors])
        for z in zones
    ]


@router.post("/zones", response_model=ZoneOut, status_code=status.HTTP_201_CREATED)
def create_zone(data: ZoneIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    need(user, "wh.structure.create")
    dc = get_dc(db, user, data.branch_id)
    zone = WhZone(branch_id=dc.id, name=clean(data.name))
    db.add(zone)
    log_wh(db, user, "create_zone", f"menambah zona {zone.name} di {dc.name}", dc)
    commit_or_conflict(db, f'Zona "{zone.name}" sudah ada di {dc.name}.')
    db.refresh(zone)
    return ZoneOut(id=zone.id, name=zone.name, sectors=[])


@router.patch("/zones/{zone_id}", response_model=ZoneOut)
def rename_zone(zone_id: int, data: NameIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    need(user, "wh.structure.update")
    zone, dc = get_zone(db, user, zone_id)
    old = zone.name
    zone.name = clean(data.name)
    log_wh(db, user, "update_zone", f"mengganti nama zona {old} jadi {zone.name} di {dc.name}", dc)
    commit_or_conflict(db, f'Zona "{zone.name}" sudah ada di {dc.name}.')
    db.refresh(zone)
    return ZoneOut(id=zone.id, name=zone.name, sectors=[])


def sectors_with_counts(db: Session, sector_ids: list[int]) -> set[int]:
    if not sector_ids:
        return set()
    return set(db.scalars(select(WhCount.sector_id).where(WhCount.sector_id.in_(sector_ids)).distinct()))


@router.post("/zones/{zone_id}/delete", status_code=status.HTTP_204_NO_CONTENT)
def delete_zone(zone_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    need(user, "wh.structure.delete")
    zone, dc = get_zone(db, user, zone_id)
    if sectors_with_counts(db, [s.id for s in zone.sectors]):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Zona {zone.name} punya sector yang sudah dipakai di hasil stock opname, jadi tidak bisa dihapus.")
    name = zone.name
    db.delete(zone)
    log_wh(db, user, "delete_zone", f"menghapus zona {name} di {dc.name}", dc)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/sectors", response_model=SectorOut, status_code=status.HTTP_201_CREATED)
def create_sector(data: SectorIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    need(user, "wh.structure.create")
    zone, dc = get_zone(db, user, data.zone_id)
    sector = WhSector(zone_id=zone.id, name=clean(data.name))
    db.add(sector)
    log_wh(db, user, "create_sector", f"menambah sector {sector.name} di zona {zone.name} ({dc.name})", dc)
    commit_or_conflict(db, f'Sector "{sector.name}" sudah ada di zona {zone.name}.')
    db.refresh(sector)
    return SectorOut(id=sector.id, name=sector.name)


@router.patch("/sectors/{sector_id}", response_model=SectorOut)
def rename_sector(sector_id: int, data: NameIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    need(user, "wh.structure.update")
    sector, dc = get_sector(db, user, sector_id)
    old = sector.name
    sector.name = clean(data.name)
    log_wh(db, user, "update_sector", f"mengganti nama sector {old} jadi {sector.name} ({dc.name})", dc)
    commit_or_conflict(db, f'Sector "{sector.name}" sudah ada di zona ini.')
    return SectorOut(id=sector.id, name=sector.name, products=placement_counts(db, [sector.id]).get(sector.id, 0))


@router.post("/sectors/delete", response_model=AddResult)
def delete_sectors(data: IdList, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    need(user, "wh.structure.delete")
    sectors = [get_sector(db, user, i) for i in dict.fromkeys(data.ids)]
    used = sectors_with_counts(db, [s.id for s, _ in sectors])
    skipped = [BulkSkip(row=i, label=s.name, reason="Sudah dipakai di hasil stock opname") for i, (s, _) in enumerate(sectors, 1) if s.id in used]
    removed = [(s, dc) for s, dc in sectors if s.id not in used]
    for s, _ in removed:
        db.delete(s)
    if removed:
        log_wh(db, user, "delete_sector", f"menghapus {len(removed)} sector ({', '.join(s.name for s, _ in removed[:5])}{'...' if len(removed) > 5 else ''})", removed[0][1])
    db.commit()
    return AddResult(added=len(removed), skipped=skipped)


def placement_out(p: WhPlacement) -> PlacementOut:
    return PlacementOut(
        id=p.id,
        barcode=p.barcode,
        name=p.product.name,
        unit=p.product.unit,
        product_code=p.product.product_code,
        category=p.product.category,
        is_active=p.product.is_active,
        sequence=p.sequence,
    )


@router.get("/sectors/{sector_id}/placements", response_model=list[PlacementOut])
def list_placements(sector_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    need(user, "wh.structure.view")
    sector, _ = get_sector(db, user, sector_id)
    rows = db.scalars(select(WhPlacement).where(WhPlacement.sector_id == sector.id).order_by(WhPlacement.sequence, WhPlacement.id))
    return [placement_out(p) for p in rows]


@router.post("/sectors/{sector_id}/placements", response_model=AddResult)
def add_placements(sector_id: int, data: BarcodeList, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    need(user, "wh.structure.create")
    sector, dc = get_sector(db, user, sector_id)
    existing = set(db.scalars(select(WhPlacement.barcode).where(WhPlacement.sector_id == sector.id)))
    seq = db.scalar(select(func.max(WhPlacement.sequence)).where(WhPlacement.sector_id == sector.id)) or 0
    added, skipped = 0, []
    for i, raw in enumerate(dict.fromkeys(b.strip() for b in data.barcodes if b.strip()), 1):
        product = db.get(WhProduct, raw)
        if product is None:
            skipped.append(BulkSkip(row=i, label=raw, reason="Produk tidak ditemukan"))
        elif product.branch_id != dc.id:
            skipped.append(BulkSkip(row=i, label=raw, reason=f"Bukan produk {dc.name}"))
        elif not product.is_active:
            skipped.append(BulkSkip(row=i, label=raw, reason="Produk nonaktif"))
        elif raw in existing:
            skipped.append(BulkSkip(row=i, label=raw, reason="Sudah ada di sector ini"))
        else:
            seq += 1
            db.add(WhPlacement(sector_id=sector.id, barcode=raw, sequence=seq))
            existing.add(raw)
            added += 1
    if added:
        log_wh(db, user, "add_placement", f"menambah {added} produk ke sector {sector.name} ({dc.name})", dc)
    db.commit()
    return AddResult(added=added, skipped=skipped)


@router.post("/placements/delete", status_code=status.HTTP_204_NO_CONTENT)
def delete_placements(data: IdList, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    need(user, "wh.structure.create", "wh.structure.delete")
    rows = list(db.scalars(select(WhPlacement).where(WhPlacement.id.in_(data.ids))))
    dc = None
    for p in rows:
        sector, dc = get_sector(db, user, p.sector_id)
    for p in rows:
        db.delete(p)
    if rows:
        log_wh(db, user, "remove_placement", f"mengeluarkan {len(rows)} produk dari sector {sector.name} ({dc.name})", dc)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/sectors/{sector_id}/order", status_code=status.HTTP_204_NO_CONTENT)
def reorder_placements(sector_id: int, data: IdList, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    need(user, "wh.structure.update", "wh.structure.create")
    sector, _ = get_sector(db, user, sector_id)
    rows = {p.id: p for p in db.scalars(select(WhPlacement).where(WhPlacement.sector_id == sector.id))}
    order = [i for i in data.ids if i in rows] + [i for i in rows if i not in data.ids]
    for n, pid in enumerate(order, 1):
        rows[pid].sequence = n
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def product_out(p: WhProduct, places: dict[str, list[str]]) -> WhProductOut:
    return WhProductOut(
        barcode=p.barcode,
        name=p.name,
        product_code=p.product_code,
        category=p.category,
        sub_category=p.sub_category,
        unit=p.unit,
        is_active=p.is_active,
        deactivated_at=p.deactivated_at,
        created_at=p.created_at,
        dc=dc_ref(p.branch),
        placements=places.get(p.barcode, []),
    )


def placement_labels(db: Session, barcodes: list[str]) -> dict[str, list[str]]:
    if not barcodes:
        return {}
    rows = db.execute(
        select(WhPlacement.barcode, WhZone.name, WhSector.name)
        .join(WhSector, WhSector.id == WhPlacement.sector_id)
        .join(WhZone, WhZone.id == WhSector.zone_id)
        .where(WhPlacement.barcode.in_(barcodes))
        .order_by(WhZone.name, WhSector.name)
    ).all()
    out: dict[str, list[str]] = {}
    for b, z, s in rows:
        out.setdefault(b, []).append(f"{z} / {s}")
    return out


@router.get("/products", response_model=WhProductList)
def list_products(
    branch_id: int | None = None,
    q: str | None = None,
    status_: str | None = Query(None, alias="status"),
    placed: str | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(25, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    need(user, "wh.product.view", "wh.structure.view")
    ids = [get_dc(db, user, branch_id).id] if branch_id else dc_ids(db, user)
    base = select(WhProduct).where(WhProduct.branch_id.in_(ids or [-1]))
    if q and q.strip():
        like = f"%{q.strip().lower()}%"
        base = base.where(
            or_(
                func.lower(WhProduct.barcode).like(like),
                func.lower(WhProduct.name).like(like),
                func.lower(func.coalesce(WhProduct.product_code, "")).like(like),
                func.lower(func.coalesce(WhProduct.category, "")).like(like),
            )
        )
    if placed in ("yes", "no"):
        sub = select(WhPlacement.barcode).distinct()
        base = base.where(WhProduct.barcode.in_(sub) if placed == "yes" else WhProduct.barcode.not_in(sub))
    sub_all = base.subquery()
    row = db.execute(
        select(func.count(), func.sum(case((sub_all.c.is_active.is_(True), 1), else_=0))).select_from(sub_all)
    ).one()
    counts = {"all": row[0] or 0, "active": int(row[1] or 0), "inactive": (row[0] or 0) - int(row[1] or 0)}
    if status_ == "active":
        base = base.where(WhProduct.is_active.is_(True))
    elif status_ == "inactive":
        base = base.where(WhProduct.is_active.is_(False))
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    items = list(db.scalars(base.order_by(WhProduct.name, WhProduct.barcode).offset((page - 1) * size).limit(size)))
    places = placement_labels(db, [p.barcode for p in items])
    return WhProductList(items=[product_out(p, places) for p in items], total=total, page=page, size=size, counts=counts)


@router.get("/products/options", response_model=list[ProductOption])
def product_options(
    branch_id: int,
    q: str | None = None,
    sector_id: int | None = None,
    limit: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    need(user, "wh.structure.create")
    dc = get_dc(db, user, branch_id)
    stmt = select(WhProduct).where(WhProduct.branch_id == dc.id, WhProduct.is_active.is_(True))
    if q and q.strip():
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(WhProduct.barcode).like(like), func.lower(WhProduct.name).like(like), func.lower(func.coalesce(WhProduct.product_code, "")).like(like)))
    placed = set()
    if sector_id:
        placed = set(db.scalars(select(WhPlacement.barcode).where(WhPlacement.sector_id == sector_id)))
    rows = db.scalars(stmt.order_by(WhProduct.name).limit(limit))
    return [ProductOption(barcode=p.barcode, name=p.name, unit=p.unit, category=p.category, placed=p.barcode in placed) for p in rows]


@router.post("/products", response_model=WhProductOut, status_code=status.HTTP_201_CREATED)
def create_product(data: WhProductIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    need(user, "wh.product.create")
    barcode = data.barcode.strip().upper()
    dc = dc_for_barcode(db, barcode)
    if dc is None:
        raise bad(f"Huruf pertama barcode harus kode DC ({barcode_rule(db)}).")
    if dc.id not in dc_ids(db, user):
        raise forbidden(f"Kamu tidak punya akses ke {dc.name}.")
    if db.get(WhProduct, barcode):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Barcode {barcode} sudah terdaftar.")
    p = WhProduct(
        barcode=barcode,
        branch_id=dc.id,
        name=clean(data.name),
        product_code=clean(data.product_code),
        category=clean(data.category),
        sub_category=clean(data.sub_category),
        unit=clean(data.unit),
    )
    db.add(p)
    log_wh(db, user, "create_product", f"menambah produk {p.name} ({barcode})", dc, barcode)
    commit_or_conflict(db, f"Barcode {barcode} sudah terdaftar.")
    db.refresh(p)
    return product_out(p, {})


def get_product(db: Session, user: User, barcode: str) -> WhProduct:
    p = db.get(WhProduct, barcode)
    if p is None or p.branch_id not in dc_ids(db, user):
        raise not_found("Produk")
    return p


@router.patch("/products/{barcode:path}", response_model=WhProductOut)
def update_product(barcode: str, data: WhProductUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    need(user, "wh.product.update")
    p = get_product(db, user, barcode)
    for field in ("name", "product_code", "category", "sub_category", "unit"):
        if field in data.model_fields_set:
            value = clean(getattr(data, field))
            if field == "name" and not value:
                raise bad("Nama produk wajib diisi.")
            setattr(p, field, value)
    log_wh(db, user, "update_product", f"memperbarui produk {p.name} ({p.barcode})", p.branch, p.barcode)
    db.commit()
    db.refresh(p)
    return product_out(p, placement_labels(db, [p.barcode]))


@router.post("/products/status", response_model=AddResult)
def set_product_status(data: StatusChange, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    need(user, "wh.product.update")
    allowed = dc_ids(db, user)
    rows = list(db.scalars(select(WhProduct).where(WhProduct.barcode.in_(data.barcodes), WhProduct.branch_id.in_(allowed or [-1]))))
    changed = [p for p in rows if p.is_active != data.active]
    for p in changed:
        p.is_active = data.active
        p.deactivated_at = None if data.active else utcnow()
    if changed:
        log_wh(db, user, "status_product", f"{'mengaktifkan' if data.active else 'menonaktifkan'} {len(changed)} produk gudang", changed[0].branch)
    db.commit()
    return AddResult(added=len(changed))


@router.post("/products/delete", response_model=AddResult)
def delete_products(data: BarcodeList, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    need(user, "wh.product.delete")
    allowed = dc_ids(db, user)
    rows = list(db.scalars(select(WhProduct).where(WhProduct.barcode.in_(data.barcodes), WhProduct.branch_id.in_(allowed or [-1]))))
    codes = [p.barcode for p in rows]
    used = set(db.scalars(select(WhCount.barcode).where(WhCount.barcode.in_(codes or ["-"])).distinct())) | set(
        db.scalars(select(WhFinal.barcode).where(WhFinal.barcode.in_(codes or ["-"])).distinct())
    )
    skipped = [BulkSkip(row=i, label=p.barcode, reason="Sudah dipakai di hasil stock opname, nonaktifkan saja") for i, p in enumerate(rows, 1) if p.barcode in used]
    removed = [p for p in rows if p.barcode not in used]
    for p in removed:
        db.execute(delete(WhPlacement).where(WhPlacement.barcode == p.barcode))
        db.delete(p)
    if removed:
        log_wh(db, user, "delete_product", f"menghapus {len(removed)} produk gudang", removed[0].branch)
    db.commit()
    return AddResult(added=len(removed), skipped=skipped)


INACTIVE_WORDS = {"not active", "notactive", "inactive", "nonaktif", "non aktif", "tidak aktif", "0", "false", "no", "n"}
ACTIVE_WORDS = {"active", "aktif", "1", "true", "yes", "y"}


def parse_status(v: str) -> bool | None:
    t = " ".join(v.lower().replace("_", " ").replace("-", " ").split())
    if not t:
        return None
    if t in INACTIVE_WORDS:
        return False
    if t in ACTIVE_WORDS:
        return True
    raise ValueError


def resolve_dc_text(text: str, dcs: list[Branch]) -> Branch | None:
    t = text.strip().lower()
    if not t:
        return None
    for dc in dcs:
        if t in (dc.code.lower(), dc.name.lower()):
            return dc
    letter = None
    if len(t) == 1:
        letter = t
    else:
        parts = t.replace("_", " ").replace("-", " ").split()
        if len(parts) >= 2 and parts[0] == "dc" and len(parts[-1]) == 1:
            letter = parts[-1]
    if letter:
        return next((dc for dc in dcs if (dc.wh_code or "").lower() == letter), None)
    return None


@router.post("/import", response_model=ImportResult)
def import_data(data: ImportIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    need(user, "wh.data.import")
    dcs = dc_list(db, user)
    res = ImportResult()
    zones: dict[tuple[int, str], WhZone] = {}
    sectors: dict[tuple[int, str], WhSector] = {}
    for z in db.scalars(select(WhZone).where(WhZone.branch_id.in_([d.id for d in dcs] or [-1]))):
        zones[(z.branch_id, z.name.lower())] = z
        for s in z.sectors:
            sectors[(z.id, s.name.lower())] = s
    placed = {(p.sector_id, p.barcode) for p in db.scalars(select(WhPlacement))}
    seqs = dict(db.execute(select(WhPlacement.sector_id, func.max(WhPlacement.sequence)).group_by(WhPlacement.sector_id)).all())
    touched: set[str] = set()
    used_dcs: set[int] = set()

    for r in data.rows:
        barcode = r.barcode.strip().upper()
        label = barcode or " / ".join(x for x in (r.zone, r.sector) if x) or f"Baris {r.row}"

        def skip(reason: str) -> None:
            res.skipped.append(BulkSkip(row=r.row, label=label, reason=reason))

        try:
            active = parse_status(r.status)
        except ValueError:
            skip(f'Status "{r.status}" tidak dikenal (pakai Active / Not Active)')
            continue

        dc = resolve_dc_text(r.dc, dcs) if r.dc.strip() else None
        if r.dc.strip() and dc is None:
            skip(f'DC "{r.dc}" tidak ditemukan atau tidak bisa kamu akses')
            continue
        prefix_dc = None
        if barcode:
            prefix_dc = next((d for d in dcs if d.wh_code and d.wh_code == barcode[:1]), None)
            if prefix_dc is None:
                skip(f"Huruf pertama barcode bukan kode DC yang bisa kamu akses ({barcode_rule(db)})")
                continue
            if dc is not None and dc.id != prefix_dc.id:
                skip(f"Barcode {barcode} milik {prefix_dc.name}, bukan {dc.name}")
                continue
            dc = prefix_dc
        if dc is None:
            skip("Kolom DC kosong dan tidak ada barcode")
            continue
        zone_name = clean(r.zone)
        sector_name = clean(r.sector)
        if sector_name and not zone_name:
            skip("Sector diisi tapi Zona kosong")
            continue
        if not barcode and not zone_name:
            skip("Tidak ada zona, sector, atau barcode")
            continue

        product = None
        if barcode:
            product = db.get(WhProduct, barcode)
            if product is None:
                if not clean(r.name):
                    skip("Produk baru tapi Nama Produk kosong")
                    continue
                product = WhProduct(
                    barcode=barcode,
                    branch_id=dc.id,
                    name=clean(r.name),
                    product_code=clean(r.product_code),
                    category=clean(r.category),
                    sub_category=clean(r.sub_category),
                    unit=clean(r.unit),
                    is_active=True if active is None else active,
                    deactivated_at=None if active is not False else utcnow(),
                )
                db.add(product)
                db.flush()
                res.products_added += 1
                touched.add(barcode)
            elif data.update_existing and barcode not in touched:
                changed = False
                for field, value in (("name", r.name), ("product_code", r.product_code), ("category", r.category), ("sub_category", r.sub_category), ("unit", r.unit)):
                    v = clean(value)
                    if v and getattr(product, field) != v:
                        setattr(product, field, v)
                        changed = True
                if active is not None and product.is_active != active:
                    product.is_active = active
                    product.deactivated_at = None if active else utcnow()
                    changed = True
                if changed:
                    res.products_updated += 1
                touched.add(barcode)

        zone = None
        if zone_name:
            zone = zones.get((dc.id, zone_name.lower()))
            if zone is None:
                zone = WhZone(branch_id=dc.id, name=zone_name)
                db.add(zone)
                db.flush()
                zones[(dc.id, zone_name.lower())] = zone
                res.zones_added += 1
        sector = None
        if zone is not None and sector_name:
            sector = sectors.get((zone.id, sector_name.lower()))
            if sector is None:
                sector = WhSector(zone_id=zone.id, name=sector_name)
                db.add(sector)
                db.flush()
                sectors[(zone.id, sector_name.lower())] = sector
                res.sectors_added += 1
        if sector is not None and product is not None and (sector.id, barcode) not in placed:
            seqs[sector.id] = (seqs.get(sector.id) or 0) + 1
            db.add(WhPlacement(sector_id=sector.id, barcode=barcode, sequence=seqs[sector.id]))
            placed.add((sector.id, barcode))
            res.placements_added += 1
        used_dcs.add(dc.id)

    changed = res.products_added + res.products_updated + res.zones_added + res.sectors_added + res.placements_added
    if changed:
        names = ", ".join(d.name for d in dcs if d.id in used_dcs)
        log_wh(
            db,
            user,
            "import_data",
            f"import data gudang {names}: {res.products_added} produk baru, {res.products_updated} diperbarui, "
            f"{res.zones_added} zona, {res.sectors_added} sector, {res.placements_added} penempatan",
            next((d for d in dcs if d.id in used_dcs), None),
        )
    db.commit()
    return res


@router.get("/dcs/{branch_id}/export", response_model=list[ExportRow])
def export_structure(branch_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    need(user, "wh.data.export")
    dc = get_dc(db, user, branch_id)
    rows: list[ExportRow] = []
    placed: set[str] = set()

    def row(zone: str, sector: str, p: WhProduct | None) -> ExportRow:
        return ExportRow(
            dc=dc.name,
            zone=zone,
            sector=sector,
            barcode=p.barcode if p else "",
            name=p.name if p else "",
            product_code=(p.product_code or "") if p else "",
            category=(p.category or "") if p else "",
            sub_category=(p.sub_category or "") if p else "",
            unit=(p.unit or "") if p else "",
            status=("Active" if p.is_active else "Not Active") if p else "",
        )

    for z in db.scalars(select(WhZone).where(WhZone.branch_id == dc.id).order_by(WhZone.name)):
        if not z.sectors:
            rows.append(row(z.name, "", None))
        for s in z.sectors:
            ps = list(db.scalars(select(WhPlacement).where(WhPlacement.sector_id == s.id).order_by(WhPlacement.sequence, WhPlacement.id)))
            if not ps:
                rows.append(row(z.name, s.name, None))
            for p in ps:
                rows.append(row(z.name, s.name, p.product))
                placed.add(p.barcode)
    for p in db.scalars(select(WhProduct).where(WhProduct.branch_id == dc.id).order_by(WhProduct.name)):
        if p.barcode not in placed:
            rows.append(row("", "", p))
    return rows


def get_session(db: Session, user: User, session_id: int) -> tuple[WhSession, Branch]:
    s = db.get(WhSession, session_id)
    if s is None:
        raise not_found("Sesi stock opname")
    return s, get_dc(db, user, s.branch_id)


def dc_placements(db: Session, branch_id: int):
    return (
        select(
            WhPlacement.id,
            WhPlacement.sector_id,
            WhPlacement.barcode,
            WhPlacement.sequence,
            WhSector.name.label("sector"),
            WhZone.id.label("zone_id"),
            WhZone.name.label("zone"),
            WhProduct.name.label("name"),
            WhProduct.unit,
            WhProduct.product_code,
            WhProduct.is_active,
        )
        .join(WhSector, WhSector.id == WhPlacement.sector_id)
        .join(WhZone, WhZone.id == WhSector.zone_id)
        .join(WhProduct, WhProduct.barcode == WhPlacement.barcode)
        .where(WhZone.branch_id == branch_id)
    )


def session_counts(db: Session, session_id: int) -> dict[tuple[int, str], WhCount]:
    return {(c.sector_id, c.barcode): c for c in db.scalars(select(WhCount).where(WhCount.session_id == session_id))}


def progress_for(db: Session, s: WhSession) -> Progress:
    counts = session_counts(db, s.id)
    total = 0
    counted = 0
    for p in db.execute(dc_placements(db, s.branch_id)).all():
        hit = (p.sector_id, p.barcode) in counts
        if p.is_active or hit:
            total += 1
            counted += 1 if hit else 0
    return Progress(counted=counted, total=total)


def session_out(db: Session, s: WhSession, dc: Branch) -> SessionOut:
    return SessionOut(
        id=s.id,
        name=s.name,
        session_date=s.session_date,
        status=s.status,
        created_by=s.created_by,
        created_at=s.created_at,
        finalized_by=s.finalized_by,
        finalized_at=s.finalized_at,
        dc=dc_ref(dc),
        progress=progress_for(db, s),
    )


@router.get("/sessions", response_model=SessionList)
def list_sessions(
    branch_id: int | None = None,
    status_: str | None = Query(None, alias="status"),
    q: str | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    need(user, "wh.session.view", "wh.count.input")
    ids = [get_dc(db, user, branch_id).id] if branch_id else dc_ids(db, user)
    base = select(WhSession).where(WhSession.branch_id.in_(ids or [-1]))
    if q and q.strip():
        base = base.where(func.lower(WhSession.name).like(f"%{q.strip().lower()}%"))
    counts = {"all": 0, "Aktif": 0, "Selesai": 0, "Final": 0}
    sub = base.subquery()
    for st, n in db.execute(select(sub.c.status, func.count()).group_by(sub.c.status)).all():
        counts[st] = n
        counts["all"] += n
    if status_ in ("Aktif", "Selesai", "Final"):
        base = base.where(WhSession.status == status_)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    items = list(db.scalars(base.order_by(WhSession.session_date.desc(), WhSession.id.desc()).offset((page - 1) * size).limit(size)))
    return SessionList(items=[session_out(db, s, s.branch) for s in items], total=total, page=page, size=size, counts=counts)


@router.post("/sessions", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
def create_session(data: SessionIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    need(user, "wh.session.create")
    dc = get_dc(db, user, data.branch_id)
    s = WhSession(branch_id=dc.id, name=clean(data.name), session_date=data.session_date, status="Aktif", created_by=user.username)
    db.add(s)
    db.flush()
    log_wh(db, user, "create_session", f"membuat sesi stock opname {s.name} di {dc.name}", dc, s.name)
    db.commit()
    db.refresh(s)
    return session_out(db, s, dc)


def require_not_final(s: WhSession) -> None:
    if s.status == "Final":
        raise bad("Sesi sudah Final. Batalkan finalisasi dulu kalau mau mengubahnya.")


@router.patch("/sessions/{session_id}", response_model=SessionOut)
def update_session(session_id: int, data: SessionUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    need(user, "wh.session.update")
    s, dc = get_session(db, user, session_id)
    require_not_final(s)
    if data.name is not None:
        s.name = clean(data.name)
    if data.session_date is not None:
        s.session_date = data.session_date
    log_wh(db, user, "update_session", f"memperbarui sesi {s.name} ({dc.name})", dc, s.name)
    db.commit()
    db.refresh(s)
    return session_out(db, s, dc)


@router.post("/sessions/{session_id}/status", response_model=SessionOut)
def change_session_status(session_id: int, data: SessionStatusIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    need(user, "wh.session.update")
    s, dc = get_session(db, user, session_id)
    require_not_final(s)
    if s.status != data.status:
        s.status = data.status
        verb = "membuka lagi" if data.status == "Aktif" else "menutup"
        log_wh(db, user, "status_session", f"{verb} sesi {s.name} ({dc.name})", dc, s.name)
        db.commit()
        db.refresh(s)
    return session_out(db, s, dc)


@router.post("/sessions/delete", status_code=status.HTTP_204_NO_CONTENT)
def delete_sessions(data: IdList, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    need(user, "wh.session.delete")
    items = [get_session(db, user, i) for i in dict.fromkeys(data.ids)]
    if any(s.status == "Final" for s, _ in items) and not user.is_master:
        raise forbidden("Sesi yang sudah Final hanya bisa dihapus Master.")
    for s, dc in items:
        log_wh(db, user, "delete_session", f"menghapus sesi {s.name} ({dc.name})", dc, s.name)
        db.delete(s)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/sessions/{session_id}", response_model=SessionDetail)
def session_detail(session_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    need(user, "wh.session.view", "wh.count.input")
    s, dc = get_session(db, user, session_id)
    counts = session_counts(db, s.id)
    zones: dict[int, dict] = {}
    for z in db.scalars(select(WhZone).where(WhZone.branch_id == dc.id).order_by(WhZone.name)):
        zones[z.id] = {"id": z.id, "name": z.name, "counted": 0, "total": 0, "sectors": {sec.id: {"id": sec.id, "name": sec.name, "counted": 0, "total": 0} for sec in z.sectors}}
    total = counted = 0
    for p in db.execute(dc_placements(db, dc.id)).all():
        hit = (p.sector_id, p.barcode) in counts
        if not (p.is_active or hit):
            continue
        z = zones[p.zone_id]
        sec = z["sectors"][p.sector_id]
        for bucket in (z, sec):
            bucket["total"] += 1
            bucket["counted"] += 1 if hit else 0
        total += 1
        counted += 1 if hit else 0
    last = db.scalar(select(func.max(WhCount.updated_at)).where(WhCount.session_id == s.id))
    base = session_out(db, s, dc)
    base.progress = Progress(counted=counted, total=total)
    return SessionDetail(
        **base.model_dump(),
        zones=[
            ZoneProgress(id=z["id"], name=z["name"], counted=z["counted"], total=z["total"], sectors=[SectorProgress(**v) for v in z["sectors"].values()])
            for z in zones.values()
        ],
        last_count_at=last,
        can={
            "update": user.can("wh.session.update") and s.status != "Final",
            "delete": user.can("wh.session.delete") and (s.status != "Final" or user.is_master),
            "input": user.can("wh.count.input") and s.status == "Aktif",
            "finalize": user.can("wh.final.approve") and s.status != "Final",
            "unfinalize": user.is_master and s.status == "Final",
            "export": user.can("wh.data.export"),
        },
    )


def count_rows(db: Session, s: WhSession, zone_id: int | None, sector_id: int | None, q: str | None, state: str | None) -> list[CountRow]:
    counts = session_counts(db, s.id)
    stmt = dc_placements(db, s.branch_id)
    if zone_id:
        stmt = stmt.where(WhZone.id == zone_id)
    if sector_id:
        stmt = stmt.where(WhSector.id == sector_id)
    if q and q.strip():
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(WhPlacement.barcode).like(like), func.lower(WhProduct.name).like(like), func.lower(func.coalesce(WhProduct.product_code, "")).like(like)))
    stmt = stmt.order_by(WhZone.name, WhSector.name, WhPlacement.sequence, WhPlacement.id)
    out = []
    for p in db.execute(stmt).all():
        c = counts.get((p.sector_id, p.barcode))
        if not (p.is_active or c):
            continue
        if state == "counted" and not c:
            continue
        if state == "uncounted" and c:
            continue
        out.append(
            CountRow(
                zone_id=p.zone_id,
                zone=p.zone,
                sector_id=p.sector_id,
                sector=p.sector,
                barcode=p.barcode,
                name=p.name,
                unit=p.unit,
                product_code=p.product_code,
                is_active=p.is_active,
                sequence=p.sequence,
                qty=num(c.qty) if c else None,
                note=c.note if c else None,
                updated_by=c.updated_by if c else None,
                updated_at=c.updated_at if c else None,
            )
        )
    return out


@router.get("/sessions/{session_id}/rows", response_model=CountRowList)
def session_rows(
    session_id: int,
    zone_id: int | None = None,
    sector_id: int | None = None,
    q: str | None = None,
    state: str | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=5000),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    need(user, "wh.session.view", "wh.count.input")
    s, _ = get_session(db, user, session_id)
    rows = count_rows(db, s, zone_id, sector_id, q, state)
    return CountRowList(items=rows[(page - 1) * size : page * size], total=len(rows), page=page, size=size)


@router.put("/sessions/{session_id}/counts", response_model=CountRow)
def save_count(session_id: int, data: CountIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    need(user, "wh.count.input")
    s, dc = get_session(db, user, session_id)
    if s.status != "Aktif":
        raise bad(f"Sesi sudah {s.status}, hitungan tidak bisa diubah lagi.")
    barcode = data.barcode.strip().upper()
    placement = db.scalar(select(WhPlacement).where(WhPlacement.sector_id == data.sector_id, WhPlacement.barcode == barcode))
    sector = db.get(WhSector, data.sector_id)
    if placement is None or sector is None or sector.zone.branch_id != dc.id:
        raise bad(f"Produk {barcode} tidak terdaftar di sector ini.")
    c = db.scalar(select(WhCount).where(WhCount.session_id == s.id, WhCount.sector_id == data.sector_id, WhCount.barcode == barcode))
    if data.qty is None:
        if c is not None:
            db.delete(c)
            db.commit()
        c = None
    else:
        if c is None and not placement.product.is_active:
            raise bad("Produk ini nonaktif. Aktifkan dulu di Produk Gudang kalau memang mau dihitung.")
        if c is None:
            c = WhCount(session_id=s.id, sector_id=data.sector_id, barcode=barcode, qty=data.qty, note=clean(data.note), updated_by=user.username)
            db.add(c)
        else:
            c.qty = data.qty
            c.note = clean(data.note)
            c.updated_by = user.username
            c.updated_at = utcnow()
        db.commit()
        db.refresh(c)
    p = placement.product
    return CountRow(
        zone_id=sector.zone.id,
        zone=sector.zone.name,
        sector_id=sector.id,
        sector=sector.name,
        barcode=barcode,
        name=p.name,
        unit=p.unit,
        product_code=p.product_code,
        is_active=p.is_active,
        sequence=placement.sequence,
        qty=num(c.qty) if c else None,
        note=c.note if c else None,
        updated_by=c.updated_by if c else None,
        updated_at=c.updated_at if c else None,
    )


def review_rows(db: Session, s: WhSession) -> tuple[list[ReviewRow], int]:
    rows = count_rows(db, s, None, None, None, None)
    agg: dict[str, ReviewRow] = {}
    uncounted = 0
    for r in rows:
        if r.qty is None:
            uncounted += 1
            continue
        a = agg.get(r.barcode)
        place = f"{r.zone} / {r.sector}"
        if a is None:
            agg[r.barcode] = ReviewRow(barcode=r.barcode, name=r.name, unit=r.unit, sectors=place, qty_count=r.qty)
        else:
            a.qty_count += r.qty
            if place not in a.sectors.split(", "):
                a.sectors += ", " + place
    finals = {f.barcode: f for f in db.scalars(select(WhFinal).where(WhFinal.session_id == s.id))}
    for b, f in finals.items():
        if b not in agg:
            p = db.get(WhProduct, b)
            agg[b] = ReviewRow(barcode=b, name=p.name if p else b, unit=p.unit if p else None, sectors="-", qty_count=num(f.qty_count) or 0)
        agg[b].qty_final = num(f.qty_final)
        agg[b].note = f.note
    return sorted(agg.values(), key=lambda x: x.barcode), uncounted


@router.get("/sessions/{session_id}/review", response_model=ReviewOut)
def session_review(session_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    need(user, "wh.session.view")
    s, _ = get_session(db, user, session_id)
    items, uncounted = review_rows(db, s)
    return ReviewOut(items=items, uncounted=uncounted, final=s.status == "Final")


@router.post("/sessions/{session_id}/finalize", response_model=SessionOut)
def finalize_session(session_id: int, data: FinalizeIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    need(user, "wh.final.approve")
    s, dc = get_session(db, user, session_id)
    require_not_final(s)
    items, _ = review_rows(db, s)
    if not items:
        raise bad("Belum ada hasil hitung di sesi ini.")
    given = {i.barcode.strip().upper(): i for i in data.items}
    unknown = [b for b in given if b not in {r.barcode for r in items}]
    if unknown:
        raise bad(f"Barcode {unknown[0]} tidak ada di hasil hitung sesi ini.")
    db.execute(delete(WhFinal).where(WhFinal.session_id == s.id))
    for r in items:
        g = given.get(r.barcode)
        db.add(
            WhFinal(
                session_id=s.id,
                barcode=r.barcode,
                qty_count=r.qty_count,
                qty_final=g.qty_final if g else r.qty_count,
                note=clean(g.note) if g else None,
            )
        )
    diff = sum(1 for r in items if r.barcode in given and given[r.barcode].qty_final != r.qty_count)
    s.status = "Final"
    s.finalized_by = user.username
    s.finalized_at = utcnow()
    log_wh(db, user, "finalize_session", f"memfinalisasi sesi {s.name} ({dc.name}): {len(items)} produk, {diff} dikoreksi", dc, s.name)
    db.commit()
    db.refresh(s)
    return session_out(db, s, dc)


@router.post("/sessions/{session_id}/unfinalize", response_model=SessionOut)
def unfinalize_session(session_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not user.is_master:
        raise forbidden("Cuma Master yang bisa membatalkan finalisasi.")
    s, dc = get_session(db, user, session_id)
    if s.status != "Final":
        raise bad("Sesi ini belum Final.")
    db.execute(delete(WhFinal).where(WhFinal.session_id == s.id))
    s.status = "Selesai"
    s.finalized_by = None
    s.finalized_at = None
    log_wh(db, user, "unfinalize_session", f"membatalkan finalisasi sesi {s.name} ({dc.name})", dc, s.name)
    db.commit()
    db.refresh(s)
    return session_out(db, s, dc)