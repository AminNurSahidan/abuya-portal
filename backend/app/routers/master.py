from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.activity import log_activity
from app.database import get_db
from app.deps import get_current_user, require_admin
from app.models import Branch, Brand, User
from app.schemas import BranchCreate, BranchOut, BranchUpdate, BrandCreate, BrandOut, BrandUpdate

router = APIRouter(prefix="/api", tags=["master"])


def commit_or_conflict(db: Session, message: str) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message)


@router.get("/brands", response_model=list[BrandOut])
def list_brands(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.scalars(select(Brand).order_by(Brand.name)).all()


@router.post("/brands", response_model=BrandOut, status_code=status.HTTP_201_CREATED)
def create_brand(data: BrandCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    brand = Brand(code=data.code.strip().upper(), name=data.name.strip())
    db.add(brand)
    log_activity(db, admin, "master", "create_brand", f"menambahkan brand {brand.name}")
    commit_or_conflict(db, "Kode atau nama brand sudah dipakai.")
    db.refresh(brand)
    return brand


@router.patch("/brands/{brand_id}", response_model=BrandOut)
def update_brand(brand_id: int, data: BrandUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    brand = db.get(Brand, brand_id)
    if brand is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Brand tidak ditemukan.")
    if data.code is not None:
        brand.code = data.code.strip().upper()
    if data.name is not None:
        brand.name = data.name.strip()
    if data.is_active is not None:
        brand.is_active = data.is_active
    log_activity(db, admin, "master", "update_brand", f"memperbarui brand {brand.name}")
    commit_or_conflict(db, "Kode atau nama brand sudah dipakai.")
    db.refresh(brand)
    return brand


@router.get("/branches", response_model=list[BranchOut])
def list_branches(brand_id: int | None = None, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    stmt = select(Branch).order_by(Branch.name)
    if brand_id is not None:
        stmt = stmt.where(Branch.brand_id == brand_id)
    return db.scalars(stmt).all()


@router.post("/branches", response_model=BranchOut, status_code=status.HTTP_201_CREATED)
def create_branch(data: BranchCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if db.get(Brand, data.brand_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Brand tidak ditemukan.")
    branch = Branch(brand_id=data.brand_id, code=data.code.strip().upper(), name=data.name.strip())
    db.add(branch)
    log_activity(db, admin, "master", "create_branch", f"menambahkan cabang {branch.name}")
    commit_or_conflict(db, "Kode cabang sudah dipakai.")
    db.refresh(branch)
    return branch


@router.patch("/branches/{branch_id}", response_model=BranchOut)
def update_branch(branch_id: int, data: BranchUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    branch = db.get(Branch, branch_id)
    if branch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cabang tidak ditemukan.")
    if data.brand_id is not None:
        if db.get(Brand, data.brand_id) is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Brand tidak ditemukan.")
        branch.brand_id = data.brand_id
    if data.code is not None:
        branch.code = data.code.strip().upper()
    if data.name is not None:
        branch.name = data.name.strip()
    if data.is_active is not None:
        branch.is_active = data.is_active
    log_activity(db, admin, "master", "update_branch", f"memperbarui cabang {branch.name}")
    commit_or_conflict(db, "Kode cabang sudah dipakai.")
    db.refresh(branch)
    return branch
