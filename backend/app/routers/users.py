import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.activity import log_activity
from app.database import get_db
from app.deps import get_master
from app.models import BRANCH_SCOPED_ROLES, Branch, Brand, User
from app.schemas import MappingUpdate, PasswordReset, Role, UserBulkDelete, UserCreate, UserOut, UserUpdate
from app.security import hash_password

router = APIRouter(prefix="/api/users", tags=["users"])


def get_user_or_404(db: Session, user_id: uuid.UUID) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User tidak ditemukan.")
    return user


def validate_role_brand(db: Session, role: str, brand_id: int | None) -> int | None:
    if role == "Master":
        return None
    if brand_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Brand wajib diisi untuk role selain Master.")
    if db.get(Brand, brand_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Brand tidak ditemukan.")
    return brand_id


@router.get("", response_model=list[UserOut])
def list_users(
    q: str | None = None,
    role: Role | None = None,
    brand_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_master),
):
    stmt = select(User).order_by(User.username)
    if q and q.strip():
        stmt = stmt.where(func.lower(User.username).like(f"%{q.strip().lower()}%"))
    if role:
        stmt = stmt.where(User.role == role)
    if brand_id is not None:
        stmt = stmt.where((User.brand_id == brand_id) | (User.brand_id.is_(None)))
    return db.scalars(stmt).all()


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(data: UserCreate, db: Session = Depends(get_db), master: User = Depends(get_master)):
    if db.scalar(select(User.id).where(User.username == data.username)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f'Username "{data.username}" sudah dipakai.')
    user = User(
        username=data.username,
        password_hash=hash_password(data.password),
        role=data.role,
        brand_id=validate_role_brand(db, data.role, data.brand_id),
    )
    db.add(user)
    log_activity(db, master, "users", "create_user", f"menambahkan user {user.username} ({user.role})")
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: uuid.UUID, data: UserUpdate, db: Session = Depends(get_db), master: User = Depends(get_master)):
    user = get_user_or_404(db, user_id)
    if user.id == master.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tidak bisa mengubah akun sendiri lewat sini.")

    role = data.role or user.role
    brand_id = data.brand_id if data.brand_id is not None else user.brand_id
    if data.role is not None or data.brand_id is not None:
        new_brand = validate_role_brand(db, role, brand_id)
        if role != user.role or new_brand != user.brand_id:
            user.token_version += 1
        if new_brand != user.brand_id:
            user.branches = [b for b in user.branches if b.brand_id == new_brand]
        user.role = role
        user.brand_id = new_brand
        if role not in BRANCH_SCOPED_ROLES:
            user.branches = []

    if data.is_active is not None and data.is_active != user.is_active:
        user.is_active = data.is_active
        if not data.is_active:
            user.token_version += 1

    log_activity(db, master, "users", "update_user", f"memperbarui user {user.username}")
    db.commit()
    db.refresh(user)
    return user


@router.post("/delete", status_code=status.HTTP_204_NO_CONTENT)
def delete_users(data: UserBulkDelete, db: Session = Depends(get_db), master: User = Depends(get_master)):
    if master.id in data.ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tidak bisa menghapus akun sendiri.")
    users = db.scalars(select(User).where(User.id.in_(data.ids))).all()
    for u in users:
        db.delete(u)
    log_activity(db, master, "users", "delete_user", f"menghapus {len(users)} user")
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{user_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(user_id: uuid.UUID, data: PasswordReset, db: Session = Depends(get_db), master: User = Depends(get_master)):
    user = get_user_or_404(db, user_id)
    user.password_hash = hash_password(data.new_password)
    user.token_version += 1
    user.failed_attempts = 0
    user.locked_until = None
    log_activity(db, master, "users", "reset_password", f"mereset password {user.username}")
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{user_id}/branches", response_model=UserOut)
def set_mapping(user_id: uuid.UUID, data: MappingUpdate, db: Session = Depends(get_db), master: User = Depends(get_master)):
    user = get_user_or_404(db, user_id)
    if user.role not in BRANCH_SCOPED_ROLES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mapping cabang hanya untuk role SM, AM, dan AMKA.")
    ids = list(dict.fromkeys(data.branch_ids))
    branches = list(db.scalars(select(Branch).where(Branch.id.in_(ids)))) if ids else []
    if len(branches) != len(ids):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ada cabang yang tidak ditemukan.")
    if any(b.brand_id != user.brand_id for b in branches):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cabang harus dari brand yang sama dengan user.")
    user.branches = branches
    log_activity(db, master, "users", "mapping", f"mengatur {len(branches)} cabang untuk {user.username}")
    db.commit()
    db.refresh(user)
    return user


@router.get("/mapping/all", response_model=list[UserOut])
def list_mapping(brand_id: int | None = Query(None), db: Session = Depends(get_db), _: User = Depends(get_master)):
    stmt = select(User).where(User.role.in_(BRANCH_SCOPED_ROLES)).order_by(User.username)
    if brand_id is not None:
        stmt = stmt.where(User.brand_id == brand_id)
    return db.scalars(stmt).all()