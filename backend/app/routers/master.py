from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.activity import log_activity
from app.database import get_db
from app.deps import get_current_user, get_master
from app.models import Branch, Brand, Pic, Product, PurchaseRequest, User
from app.schemas import (
    BranchIn,
    BranchOut,
    BranchUpdate,
    BrandOut,
    BulkDelete,
    PicIn,
    PicOut,
    PicUpdate,
    ProductIn,
    ProductOut,
    ProductUpdate,
    Shipping,
)
from app.scope import accessible_branches, scope_catalog

router = APIRouter(prefix="/api", tags=["master"])


def commit_or_conflict(db: Session, message: str) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message)


def ensure_brand(db: Session, brand_id: int | None) -> None:
    if brand_id is not None and db.get(Brand, brand_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Brand tidak ditemukan.")


def get_or_404(db: Session, model, obj_id: int, label: str):
    obj = db.get(model, obj_id)
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{label} tidak ditemukan.")
    return obj


@router.get("/brands", response_model=list[BrandOut])
def list_brands(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.scalars(select(Brand).order_by(Brand.name)).all()


@router.get("/branches", response_model=list[BranchOut])
def list_branches(brand_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return accessible_branches(db, user, brand_id)


@router.post("/branches", response_model=BranchOut, status_code=status.HTTP_201_CREATED)
def create_branch(data: BranchIn, db: Session = Depends(get_db), master: User = Depends(get_master)):
    ensure_brand(db, data.brand_id)
    branch = Branch(code=data.code.strip().upper(), name=data.name.strip(), brand_id=data.brand_id)
    db.add(branch)
    log_activity(db, master, "master", "create_branch", f"menambahkan cabang {branch.name}")
    commit_or_conflict(db, "Nama atau kode cabang sudah dipakai.")
    db.refresh(branch)
    return branch


@router.patch("/branches/{branch_id}", response_model=BranchOut)
def update_branch(branch_id: int, data: BranchUpdate, db: Session = Depends(get_db), master: User = Depends(get_master)):
    branch = get_or_404(db, Branch, branch_id, "Cabang")
    if data.brand_id is not None:
        ensure_brand(db, data.brand_id)
        branch.brand_id = data.brand_id
    if data.code is not None:
        branch.code = data.code.strip().upper()
    if data.name is not None:
        branch.name = data.name.strip()
    log_activity(db, master, "master", "update_branch", f"memperbarui cabang {branch.name}")
    commit_or_conflict(db, "Nama atau kode cabang sudah dipakai.")
    db.refresh(branch)
    return branch


@router.post("/branches/delete", status_code=status.HTTP_204_NO_CONTENT)
def delete_branches(data: BulkDelete, db: Session = Depends(get_db), master: User = Depends(get_master)):
    used = db.scalar(select(func.count()).select_from(PurchaseRequest).where(PurchaseRequest.branch_id.in_(data.ids)))
    if used:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ada cabang yang masih dipakai di PR, jadi tidak bisa dihapus.")
    db.execute(delete(Branch).where(Branch.id.in_(data.ids)))
    log_activity(db, master, "master", "delete_branch", f"menghapus {len(data.ids)} cabang")
    commit_or_conflict(db, "Ada cabang yang masih dipakai di PR, jadi tidak bisa dihapus.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/products", response_model=list[ProductOut])
def list_products(brand_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    stmt = scope_catalog(select(Product), Product.brand_id, user, brand_id).order_by(Product.name, Product.unit)
    return db.scalars(stmt).all()


@router.post("/products", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
def create_product(data: ProductIn, db: Session = Depends(get_db), master: User = Depends(get_master)):
    ensure_brand(db, data.brand_id)
    unit = (data.unit or "").strip() or None
    name = data.name.strip()
    dup = db.scalar(
        select(func.count()).select_from(Product).where(
            func.lower(Product.name) == name.lower(), func.lower(func.coalesce(Product.unit, "")) == (unit or "").lower()
        )
    )
    if dup:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Produk dengan nama dan unit itu sudah ada.")
    product = Product(name=name, unit=unit, brand_id=data.brand_id)
    db.add(product)
    log_activity(db, master, "master", "create_product", f"menambahkan produk {product.display_name}")
    commit_or_conflict(db, "Produk dengan nama dan unit itu sudah ada.")
    db.refresh(product)
    return product


@router.patch("/products/{product_id}", response_model=ProductOut)
def update_product(product_id: int, data: ProductUpdate, db: Session = Depends(get_db), master: User = Depends(get_master)):
    product = get_or_404(db, Product, product_id, "Produk")
    if data.name is not None:
        product.name = data.name.strip()
    if data.unit is not None:
        product.unit = data.unit.strip() or None
    if data.clear_brand:
        product.brand_id = None
    elif data.brand_id is not None:
        ensure_brand(db, data.brand_id)
        product.brand_id = data.brand_id
    log_activity(db, master, "master", "update_product", f"memperbarui produk {product.display_name}")
    commit_or_conflict(db, "Produk dengan nama dan unit itu sudah ada.")
    db.refresh(product)
    return product


@router.post("/products/delete", status_code=status.HTTP_204_NO_CONTENT)
def delete_products(data: BulkDelete, db: Session = Depends(get_db), master: User = Depends(get_master)):
    db.execute(delete(Product).where(Product.id.in_(data.ids)))
    log_activity(db, master, "master", "delete_product", f"menghapus {len(data.ids)} produk")
    commit_or_conflict(db, "Produk tidak bisa dihapus.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/pics", response_model=list[PicOut])
def list_pics(
    brand_id: int | None = None,
    shipping: Shipping | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = scope_catalog(select(Pic), Pic.brand_id, user, brand_id).order_by(Pic.name)
    if shipping:
        stmt = stmt.where((Pic.shipping.is_(None)) | (Pic.shipping == shipping))
    return db.scalars(stmt).all()


@router.post("/pics", response_model=PicOut, status_code=status.HTTP_201_CREATED)
def create_pic(data: PicIn, db: Session = Depends(get_db), master: User = Depends(get_master)):
    ensure_brand(db, data.brand_id)
    pic = Pic(name=data.name.strip(), shipping=data.shipping, brand_id=data.brand_id)
    db.add(pic)
    log_activity(db, master, "master", "create_pic", f"menambahkan PIC {pic.name}")
    commit_or_conflict(db, "PIC dengan nama, shipping, dan brand itu sudah ada.")
    db.refresh(pic)
    return pic


@router.patch("/pics/{pic_id}", response_model=PicOut)
def update_pic(pic_id: int, data: PicUpdate, db: Session = Depends(get_db), master: User = Depends(get_master)):
    pic = get_or_404(db, Pic, pic_id, "PIC")
    if data.name is not None:
        pic.name = data.name.strip()
    if data.shipping is not None:
        pic.shipping = data.shipping
    if data.clear_brand:
        pic.brand_id = None
    elif data.brand_id is not None:
        ensure_brand(db, data.brand_id)
        pic.brand_id = data.brand_id
    log_activity(db, master, "master", "update_pic", f"memperbarui PIC {pic.name}")
    commit_or_conflict(db, "PIC dengan nama, shipping, dan brand itu sudah ada.")
    db.refresh(pic)
    return pic


@router.post("/pics/delete", status_code=status.HTTP_204_NO_CONTENT)
def delete_pics(data: BulkDelete, db: Session = Depends(get_db), master: User = Depends(get_master)):
    db.execute(delete(Pic).where(Pic.id.in_(data.ids)))
    log_activity(db, master, "master", "delete_pic", f"menghapus {len(data.ids)} PIC")
    commit_or_conflict(db, "PIC tidak bisa dihapus.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)