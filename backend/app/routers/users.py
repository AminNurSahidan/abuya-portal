import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.activity import log_activity
from app.database import get_db
from app.deps import require_admin
from app.models import Branch, User
from app.schemas import PasswordReset, Role, UserCreate, UserList, UserOut, UserUpdate
from app.security import hash_password

router = APIRouter(prefix="/api/users", tags=["users"])


def get_user_or_404(db: Session, user_id: uuid.UUID) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User tidak ditemukan.")
    return user


def resolve_branches(db: Session, branch_ids: list[int]) -> list[Branch]:
    ids = list(dict.fromkeys(branch_ids))
    if not ids:
        return []
    branches = list(db.scalars(select(Branch).where(Branch.id.in_(ids))))
    if len(branches) != len(ids):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ada cabang yang tidak ditemukan.")
    return branches


@router.get("", response_model=UserList)
def list_users(
    q: str | None = None,
    role: Role | None = None,
    active: bool | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    stmt = select(User)
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(User.email).like(like), func.lower(User.full_name).like(like)))
    if role:
        stmt = stmt.where(User.role == role)
    if active is not None:
        stmt = stmt.where(User.is_active == active)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = db.scalars(stmt.order_by(User.full_name).offset((page - 1) * size).limit(size)).all()
    return UserList(items=items, total=total, page=page, size=size)


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(data: UserCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if db.scalar(select(User.id).where(User.email == data.email)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email sudah terdaftar.")
    user = User(
        email=data.email,
        full_name=data.full_name.strip(),
        role=data.role,
        password_hash=hash_password(data.password),
    )
    user.branches = resolve_branches(db, data.branch_ids)
    db.add(user)
    log_activity(db, admin, "users", "create_user", f"menambahkan user {user.full_name}")
    db.commit()
    db.refresh(user)
    return user


@router.get("/{user_id}", response_model=UserOut)
def get_user(user_id: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return get_user_or_404(db, user_id)


@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: uuid.UUID, data: UserUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    user = get_user_or_404(db, user_id)
    is_self = user.id == admin.id

    if is_self and data.is_active is False:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tidak bisa menonaktifkan akun sendiri.")
    if is_self and data.role is not None and data.role != "admin":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tidak bisa menurunkan role akun sendiri.")

    if data.full_name is not None:
        user.full_name = data.full_name.strip()
    if data.role is not None and data.role != user.role:
        user.role = data.role
        user.token_version += 1
    if data.is_active is not None and data.is_active != user.is_active:
        user.is_active = data.is_active
        if not data.is_active:
            user.token_version += 1
    if data.branch_ids is not None:
        user.branches = resolve_branches(db, data.branch_ids)

    log_activity(db, admin, "users", "update_user", f"memperbarui user {user.full_name}")
    db.commit()
    db.refresh(user)
    return user


@router.post("/{user_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(user_id: uuid.UUID, data: PasswordReset, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    user = get_user_or_404(db, user_id)
    user.password_hash = hash_password(data.new_password)
    user.token_version += 1
    user.failed_attempts = 0
    user.locked_until = None
    log_activity(db, admin, "users", "reset_password", f"mereset kata sandi {user.full_name}")
    db.commit()


@router.post("/{user_id}/unlock", status_code=status.HTTP_204_NO_CONTENT)
def unlock_user(user_id: uuid.UUID, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    user = get_user_or_404(db, user_id)
    user.failed_attempts = 0
    user.locked_until = None
    log_activity(db, admin, "users", "unlock_user", f"membuka kunci akun {user.full_name}")
    db.commit()
