from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.activity import log_activity
from app.database import get_db
from app.deps import get_master
from app.models import PERMISSION_COLUMNS, PERMISSION_GRID, PERMISSIONS, Brand, Role, User
from app.schemas import BulkDelete, PermissionCell, PermissionGrid, PermissionGroup, PermissionOut, PermissionRow, RoleIn, RoleOut, RoleUpdate

router = APIRouter(prefix="/api/roles", tags=["roles"])


def bad(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def clean_perms(perms: list[str]) -> list[str]:
    unknown = [p for p in perms if p not in PERMISSIONS]
    if unknown:
        raise bad("Hak akses tidak dikenal: " + ", ".join(unknown))
    return [p for p in PERMISSIONS if p in perms]


def user_counts(db: Session) -> dict[str, int]:
    return dict(db.execute(select(User.role, func.count()).group_by(User.role)).all())


def role_out(role: Role, counts: dict[str, int]) -> RoleOut:
    out = RoleOut.model_validate(role)
    out.user_count = counts.get(role.name, 0)
    return out


def get_role(db: Session, role_id: int) -> Role:
    role = db.get(Role, role_id)
    if role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role tidak ditemukan.")
    return role


def check_name(db: Session, name: str, role_id: int | None = None) -> str:
    name = " ".join(name.split())
    stmt = select(Role.id).where(func.lower(Role.name) == name.lower())
    if role_id is not None:
        stmt = stmt.where(Role.id != role_id)
    if db.scalar(stmt):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f'Role "{name}" sudah ada.')
    return name


def check_brand(db: Session, brand_id: int | None) -> None:
    if brand_id is not None and db.get(Brand, brand_id) is None:
        raise bad("Brand tidak ditemukan.")


@router.get("/permissions", response_model=PermissionGrid)
def list_permissions(_: User = Depends(get_master)):
    return PermissionGrid(
        columns=[PermissionCell(key=k, label=v) for k, v in PERMISSION_COLUMNS],
        groups=[
            PermissionGroup(
                label=group,
                rows=[PermissionRow(label=label, cells=cells) for label, cells in rows],
            )
            for group, rows in PERMISSION_GRID
        ],
        flat=[PermissionOut(key=k, label=v) for k, v in PERMISSIONS.items()],
    )


@router.get("", response_model=list[RoleOut])
def list_roles(db: Session = Depends(get_db), _: User = Depends(get_master)):
    counts = user_counts(db)
    roles = db.scalars(select(Role).order_by(Role.id)).all()
    return [role_out(r, counts) for r in roles]


@router.post("", response_model=RoleOut, status_code=status.HTTP_201_CREATED)
def create_role(data: RoleIn, db: Session = Depends(get_db), master: User = Depends(get_master)):
    name = check_name(db, data.name)
    check_brand(db, data.brand_id)
    role = Role(name=name, brand_id=data.brand_id, permissions=clean_perms(data.permissions))
    db.add(role)
    log_activity(db, master, "roles", "create_role", f"menambahkan role {name}")
    db.commit()
    db.refresh(role)
    return role_out(role, user_counts(db))


@router.patch("/{role_id}", response_model=RoleOut)
def update_role(role_id: int, data: RoleUpdate, db: Session = Depends(get_db), master: User = Depends(get_master)):
    role = get_role(db, role_id)
    if role.is_locked:
        raise bad("Role Master selalu punya semua akses dan tidak bisa diubah.")
    old_name = role.name

    if data.clear_brand:
        role.brand_id = None
    elif data.brand_id is not None and data.brand_id != role.brand_id:
        check_brand(db, data.brand_id)
        other = db.scalar(select(func.count()).select_from(User).where(User.role == old_name, User.brand_id != data.brand_id))
        if other:
            raise bad(f"Masih ada {other} user role {old_name} dari brand lain. Pindahkan dulu brand/role user tersebut.")
        role.brand_id = data.brand_id

    if data.permissions is not None:
        role.permissions = clean_perms(data.permissions)

    if data.name is not None:
        name = check_name(db, data.name, role.id)
        if name.lower() == "master":
            raise bad("Nama Master khusus untuk role Master.")
        if name != old_name:
            db.execute(update(User).where(User.role == old_name).values(role=name).execution_options(synchronize_session=False))
            role.name = name

    log_activity(db, master, "roles", "update_role", f"memperbarui role {role.name}")
    db.commit()
    db.refresh(role)
    return role_out(role, user_counts(db))


@router.post("/delete", status_code=status.HTTP_204_NO_CONTENT)
def delete_roles(data: BulkDelete, db: Session = Depends(get_db), master: User = Depends(get_master)):
    roles = db.scalars(select(Role).where(Role.id.in_(data.ids))).all()
    counts = user_counts(db)
    for r in roles:
        if r.is_locked:
            raise bad("Role Master tidak bisa dihapus.")
        if counts.get(r.name):
            raise bad(f"Role {r.name} masih dipakai {counts[r.name]} user. Ganti role user tersebut dulu.")
    for r in roles:
        db.delete(r)
    log_activity(db, master, "roles", "delete_role", f"menghapus {len(roles)} role")
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)