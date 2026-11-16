from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.activity import log_activity
from app.database import get_db
from app.deps import get_current_user
from app.models import Branch, Pic, Product, PurchaseOrder, PurchaseRequest, PurchaseRequestItem, User
from app.numbering import next_number
from app.schemas import (
    ExportRow,
    ItemIn,
    ItemOut,
    ItemQty,
    PODetail,
    POList,
    PRDetail,
    PRFormOptions,
    PRIn,
    PRList,
    PRStatus,
    Shipping,
    StageBranch,
    StageSummary,
)
from app.scope import (
    APPROVE_NOW_ROLES,
    accessible_branches,
    can_access_branch,
    can_create_pr,
    can_edit_pr,
    expire_overdue,
    scope_by_branch,
    scope_catalog,
    today_wib,
)

router = APIRouter(prefix="/api", tags=["purchasing"])

PR_SORT = {
    "number": PurchaseRequest.number,
    "branch": Branch.name,
    "shipping": PurchaseRequest.shipping_category,
    "pic": PurchaseRequest.pic,
    "required_date": PurchaseRequest.required_date,
    "status": PurchaseRequest.status,
    "created_at": PurchaseRequest.created_at,
}

PO_SORT = {
    "number": PurchaseOrder.number,
    "pr_number": PurchaseRequest.number,
    "branch": Branch.name,
    "shipping": PurchaseRequest.shipping_category,
    "pic": PurchaseRequest.pic,
    "created_at": PurchaseOrder.created_at,
}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def forbidden(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def pr_base(user: User, brand_id: int | None):
    stmt = select(PurchaseRequest).join(Branch, Branch.id == PurchaseRequest.branch_id)
    return scope_by_branch(stmt, PurchaseRequest.branch_id, PurchaseRequest.brand_id, user, brand_id)


def po_base(user: User, brand_id: int | None):
    stmt = (
        select(PurchaseOrder)
        .join(PurchaseRequest, PurchaseRequest.id == PurchaseOrder.pr_id)
        .join(Branch, Branch.id == PurchaseRequest.branch_id)
    )
    return scope_by_branch(stmt, PurchaseRequest.branch_id, PurchaseRequest.brand_id, user, brand_id)


def apply_sort(stmt, mapping: dict, sort: str, direction: str, default_col):
    col = mapping.get(sort, default_col)
    ordered = col.asc() if direction == "asc" else col.desc()
    tie = default_col.desc() if col is not default_col else None
    return stmt.order_by(ordered, tie) if tie is not None else stmt.order_by(ordered)


def paginate(db: Session, stmt, page: int, size: int):
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    items = db.scalars(stmt.offset((page - 1) * size).limit(size)).all()
    return items, total


def load_pr(db: Session, user: User, pr_id: int) -> PurchaseRequest:
    pr = db.scalar(pr_base(user, None).where(PurchaseRequest.id == pr_id))
    if pr is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PR tidak ditemukan.")
    return pr


def pr_detail(pr: PurchaseRequest, user: User) -> PRDetail:
    out = PRDetail.model_validate(pr)
    out.can_edit = can_edit_pr(user, pr)
    out.can_approve_now = out.can_edit and user.role in APPROVE_NOW_ROLES
    return out


def require_editable(user: User, pr: PurchaseRequest) -> None:
    if pr.status != "Pending":
        raise bad_request(f"PR sudah {pr.status}, tidak bisa diubah lagi.")
    if not can_edit_pr(user, pr):
        raise forbidden("Role kamu tidak punya akses untuk mengubah PR ini.")


def touch(pr: PurchaseRequest, user: User) -> None:
    pr.updated_at = now_utc()
    pr.updated_by = user.username


def resolve_product(db: Session, product_id: int, brand_id: int | None) -> Product:
    product = db.get(Product, product_id)
    if product is None:
        raise bad_request("Barang tidak ditemukan.")
    if product.brand_id is not None and product.brand_id != brand_id:
        raise bad_request(f"Barang {product.display_name} bukan untuk brand ini.")
    return product


def release_po(db: Session, pr: PurchaseRequest, user: User) -> PurchaseOrder:
    po = PurchaseOrder(number=next_number(db, "PO"), pr_id=pr.id, created_by=user.username, created_at=now_utc())
    db.add(po)
    return po


@router.get("/purchase-requests/form-options", response_model=PRFormOptions)
def form_options(brand_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    branches = accessible_branches(db, user, brand_id)
    products = db.scalars(scope_catalog(select(Product), Product.brand_id, user, brand_id).order_by(Product.name, Product.unit)).all()
    pics = db.scalars(scope_catalog(select(Pic), Pic.brand_id, user, brand_id).order_by(Pic.name)).all()
    return PRFormOptions(
        branches=branches,
        products=products,
        pics=pics,
        can_create=can_create_pr(user),
        can_approve_now=user.role in APPROVE_NOW_ROLES,
    )


@router.get("/purchase-requests", response_model=PRList)
def list_prs(
    status_: PRStatus | None = Query(None, alias="status"),
    branch_id: list[int] | None = Query(None),
    shipping: Shipping | None = None,
    q: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    brand_id: int | None = None,
    sort: str = "created_at",
    direction: str = Query("desc", alias="dir", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    expire_overdue(db)
    stmt = pr_base(user, brand_id)
    if status_:
        stmt = stmt.where(PurchaseRequest.status == status_)
    if branch_id:
        stmt = stmt.where(PurchaseRequest.branch_id.in_(branch_id))
    if shipping:
        stmt = stmt.where(PurchaseRequest.shipping_category == shipping)
    if date_from:
        stmt = stmt.where(PurchaseRequest.required_date >= date_from)
    if date_to:
        stmt = stmt.where(PurchaseRequest.required_date <= date_to)
    if q and q.strip():
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(PurchaseRequest.number).like(like),
                func.lower(Branch.name).like(like),
                func.lower(func.coalesce(PurchaseRequest.pic, "")).like(like),
                func.lower(func.coalesce(PurchaseRequest.notes, "")).like(like),
            )
        )
    stmt = apply_sort(stmt, PR_SORT, sort, direction, PurchaseRequest.created_at)
    items, total = paginate(db, stmt, page, size)
    return PRList(items=items, total=total, page=page, size=size)


@router.get("/purchase-requests/summary", response_model=StageSummary)
def pr_summary(
    status_: PRStatus | None = Query(None, alias="status"),
    brand_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    expire_overdue(db)
    count_stmt = scope_by_branch(
        select(PurchaseRequest.status, func.count()).group_by(PurchaseRequest.status),
        PurchaseRequest.branch_id,
        PurchaseRequest.brand_id,
        user,
        brand_id,
    )
    by_key = {k: c for k, c in db.execute(count_stmt).all()}

    branch_stmt = scope_by_branch(
        select(Branch, func.count(PurchaseRequest.id))
        .join(PurchaseRequest, PurchaseRequest.branch_id == Branch.id)
        .group_by(Branch.id),
        PurchaseRequest.branch_id,
        PurchaseRequest.brand_id,
        user,
        brand_id,
    )
    if status_:
        branch_stmt = branch_stmt.where(PurchaseRequest.status == status_)
    rows = sorted(db.execute(branch_stmt).all(), key=lambda r: (-r[1], r[0].name))
    return StageSummary(
        total=sum(by_key.values()),
        by_key=by_key,
        branches=[StageBranch(branch=b, count=c) for b, c in rows],
    )


@router.post("/purchase-requests", response_model=PRDetail, status_code=status.HTTP_201_CREATED)
def create_pr(data: PRIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not can_create_pr(user):
        if user.is_branch_scoped and not user.branches:
            raise forbidden("Akun kamu belum punya mapping cabang. Hubungi Master.")
        raise forbidden(f"Role {user.role} tidak bisa membuat Purchase Request.")
    if data.approve_now and user.role not in APPROVE_NOW_ROLES:
        raise forbidden(f"Role {user.role} tidak bisa langsung menyetujui PR.")

    if data.required_date <= today_wib():
        raise bad_request("Required Date minimal besok, karena PR otomatis Expired di hari Required Date.")

    branch = db.get(Branch, data.branch_id)
    if branch is None or not can_access_branch(user, branch):
        raise bad_request("Cabang tidak ditemukan atau bukan cabang kamu.")
    brand = branch.brand
    if brand is not None and brand.direct_only and data.shipping_category != "Direct":
        raise bad_request(f"Brand {brand.name} hanya bisa pakai shipping Direct.")

    pic_ok = db.scalar(
        select(func.count())
        .select_from(Pic)
        .where(Pic.name == data.pic.strip())
        .where(or_(Pic.shipping.is_(None), Pic.shipping == data.shipping_category))
        .where(or_(Pic.brand_id.is_(None), Pic.brand_id == branch.brand_id))
    )
    if not pic_ok:
        raise bad_request("PIC tidak cocok dengan shipping atau brand cabang ini.")

    seen = set()
    items = []
    for it in data.items:
        if it.product_id in seen:
            raise bad_request("Ada barang yang dobel di daftar item.")
        seen.add(it.product_id)
        product = resolve_product(db, it.product_id, branch.brand_id)
        items.append(PurchaseRequestItem(product_id=product.id, item_name=product.display_name, qty=it.qty))

    pr = PurchaseRequest(
        number=next_number(db, "PR"),
        branch_id=branch.id,
        brand_id=branch.brand_id,
        shipping_category=data.shipping_category,
        pic=data.pic.strip(),
        required_date=data.required_date,
        notes=(data.notes or "").strip() or None,
        status="Approved" if data.approve_now else "Pending",
        created_by=user.username,
        created_at=now_utc(),
        items=items,
    )
    db.add(pr)
    db.flush()
    if data.approve_now:
        release_po(db, pr, user)
    log_activity(db, user, "approval", "create_pr", f"membuat {pr.number} untuk {branch.name}" + (" (langsung disetujui)" if data.approve_now else ""))
    db.commit()
    db.refresh(pr)
    return pr_detail(pr, user)


@router.get("/purchase-requests/{pr_id}", response_model=PRDetail)
def get_pr(pr_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    expire_overdue(db)
    return pr_detail(load_pr(db, user, pr_id), user)


@router.post("/purchase-requests/{pr_id}/items", response_model=PRDetail)
def add_item(pr_id: int, data: ItemIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    expire_overdue(db)
    pr = load_pr(db, user, pr_id)
    require_editable(user, pr)
    product = resolve_product(db, data.product_id, pr.brand_id)
    if any(i.product_id == product.id or i.item_name == product.display_name for i in pr.items):
        raise bad_request("Barang ini sudah ada di PR.")
    pr.items.append(PurchaseRequestItem(product_id=product.id, item_name=product.display_name, qty=data.qty))
    touch(pr, user)
    db.commit()
    db.refresh(pr)
    return pr_detail(pr, user)


@router.patch("/purchase-requests/{pr_id}/items/{item_id}", response_model=PRDetail)
def update_item(pr_id: int, item_id: int, data: ItemQty, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    expire_overdue(db)
    pr = load_pr(db, user, pr_id)
    require_editable(user, pr)
    item = next((i for i in pr.items if i.id == item_id), None)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item tidak ditemukan.")
    item.qty = data.qty
    touch(pr, user)
    db.commit()
    db.refresh(pr)
    return pr_detail(pr, user)


@router.delete("/purchase-requests/{pr_id}/items/{item_id}", response_model=PRDetail)
def delete_item(pr_id: int, item_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    expire_overdue(db)
    pr = load_pr(db, user, pr_id)
    require_editable(user, pr)
    item = next((i for i in pr.items if i.id == item_id), None)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item tidak ditemukan.")
    if len(pr.items) <= 1:
        raise bad_request("PR minimal harus punya 1 item.")
    pr.items.remove(item)
    touch(pr, user)
    db.commit()
    db.refresh(pr)
    return pr_detail(pr, user)


@router.post("/purchase-requests/{pr_id}/touch", response_model=PRDetail)
def save_draft(pr_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    pr = load_pr(db, user, pr_id)
    require_editable(user, pr)
    touch(pr, user)
    db.commit()
    db.refresh(pr)
    return pr_detail(pr, user)


@router.post("/purchase-requests/{pr_id}/approve", response_model=PRDetail)
def approve_pr(pr_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    expire_overdue(db)
    pr = load_pr(db, user, pr_id)
    require_editable(user, pr)
    if not pr.items:
        raise bad_request("PR belum punya item.")
    pr.status = "Approved"
    touch(pr, user)
    po = release_po(db, pr, user)
    log_activity(db, user, "approval", "approve_pr", f"menyetujui {pr.number}, {po.number} terbit")
    db.commit()
    db.refresh(pr)
    return pr_detail(pr, user)


@router.post("/purchase-requests/{pr_id}/reject", response_model=PRDetail)
def reject_pr(pr_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    expire_overdue(db)
    pr = load_pr(db, user, pr_id)
    require_editable(user, pr)
    pr.status = "Rejected"
    touch(pr, user)
    log_activity(db, user, "approval", "reject_pr", f"menolak {pr.number}")
    db.commit()
    db.refresh(pr)
    return pr_detail(pr, user)


def filtered_pos(
    user: User,
    shipping: str | None,
    branch_id: list[int] | None,
    q: str | None,
    date_from: date | None,
    date_to: date | None,
    brand_id: int | None,
):
    stmt = po_base(user, brand_id)
    if shipping:
        stmt = stmt.where(PurchaseRequest.shipping_category == shipping)
    if branch_id:
        stmt = stmt.where(PurchaseRequest.branch_id.in_(branch_id))
    if date_from:
        stmt = stmt.where(func.date(PurchaseOrder.created_at) >= date_from)
    if date_to:
        stmt = stmt.where(func.date(PurchaseOrder.created_at) <= date_to)
    if q and q.strip():
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(PurchaseOrder.number).like(like),
                func.lower(PurchaseRequest.number).like(like),
                func.lower(Branch.name).like(like),
                func.lower(func.coalesce(PurchaseRequest.pic, "")).like(like),
            )
        )
    return stmt


@router.get("/purchase-orders", response_model=POList)
def list_pos(
    shipping: Shipping | None = None,
    branch_id: list[int] | None = Query(None),
    q: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    brand_id: int | None = None,
    sort: str = "created_at",
    direction: str = Query("desc", alias="dir", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = filtered_pos(user, shipping, branch_id, q, date_from, date_to, brand_id)
    stmt = apply_sort(stmt, PO_SORT, sort, direction, PurchaseOrder.created_at)
    items, total = paginate(db, stmt, page, size)
    return POList(items=items, total=total, page=page, size=size)


@router.get("/purchase-orders/summary", response_model=StageSummary)
def po_summary(
    shipping: Shipping | None = None,
    brand_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    count_stmt = scope_by_branch(
        select(PurchaseRequest.shipping_category, func.count(PurchaseOrder.id))
        .join(PurchaseRequest, PurchaseRequest.id == PurchaseOrder.pr_id)
        .group_by(PurchaseRequest.shipping_category),
        PurchaseRequest.branch_id,
        PurchaseRequest.brand_id,
        user,
        brand_id,
    )
    by_key = {k: c for k, c in db.execute(count_stmt).all()}

    branch_stmt = scope_by_branch(
        select(Branch, func.count(PurchaseOrder.id))
        .join(PurchaseRequest, PurchaseRequest.branch_id == Branch.id)
        .join(PurchaseOrder, PurchaseOrder.pr_id == PurchaseRequest.id)
        .group_by(Branch.id),
        PurchaseRequest.branch_id,
        PurchaseRequest.brand_id,
        user,
        brand_id,
    )
    if shipping:
        branch_stmt = branch_stmt.where(PurchaseRequest.shipping_category == shipping)
    rows = sorted(db.execute(branch_stmt).all(), key=lambda r: (-r[1], r[0].name))
    return StageSummary(
        total=sum(by_key.values()),
        by_key=by_key,
        branches=[StageBranch(branch=b, count=c) for b, c in rows],
    )


@router.get("/purchase-orders/export", response_model=list[ExportRow])
def export_pos(
    po_id: int | None = None,
    shipping: Shipping | None = None,
    branch_id: list[int] | None = Query(None),
    q: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    brand_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = filtered_pos(user, shipping, branch_id, q, date_from, date_to, brand_id)
    if po_id is not None:
        stmt = stmt.where(PurchaseOrder.id == po_id)
    pos = db.scalars(stmt.order_by(PurchaseOrder.created_at.desc()).limit(5000)).all()
    rows: list[ExportRow] = []
    for po in pos:
        pr = po.pr
        base = dict(
            purchase_date=po.created_at,
            required_date=pr.required_date,
            po_number=po.number,
            pr_number=pr.number,
            branch=pr.branch.name,
            shipping=pr.shipping_category or "-",
            pic=pr.pic or "-",
            notes=pr.notes or "",
            created_by=po.created_by or "-",
        )
        if not pr.items:
            rows.append(ExportRow(**base, product_name="-", unit="", qty=None))
            continue
        for it in pr.items:
            if it.product is not None:
                name, unit = it.product.name, it.product.unit or ""
            else:
                name, unit = it.item_name, ""
            rows.append(ExportRow(**base, product_name=name, unit=unit, qty=it.qty))
    return rows


@router.get("/purchase-orders/{po_id}", response_model=PODetail)
def get_po(po_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    po = db.scalar(po_base(user, None).where(PurchaseOrder.id == po_id))
    if po is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PO tidak ditemukan.")
    out = PODetail.model_validate(po)
    out.items = [ItemOut.model_validate(i) for i in po.pr.items]
    return out