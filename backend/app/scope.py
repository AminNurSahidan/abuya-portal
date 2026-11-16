from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from app.models import Branch, PurchaseRequest, User

WIB = timezone(timedelta(hours=7))

CREATE_ROLES = ("SM", "AMKA", "Master")
APPROVE_ROLES = ("AM", "AMKA", "Master")
APPROVE_NOW_ROLES = ("AMKA", "Master")


def today_wib() -> date:
    return datetime.now(WIB).date()


def effective_brand_id(user: User, brand_id: int | None) -> int | None:
    if user.role == "Master":
        return brand_id
    return user.brand_id


def user_branch_ids(user: User) -> list[int] | None:
    if not user.is_branch_scoped:
        return None
    return [b.id for b in user.branches]


def scope_by_branch(stmt, branch_col, brand_col, user: User, brand_id: int | None = None):
    bid = effective_brand_id(user, brand_id)
    if bid is not None:
        stmt = stmt.where(brand_col == bid)
    ids = user_branch_ids(user)
    if ids is not None:
        stmt = stmt.where(branch_col.in_(ids or [-1]))
    return stmt


def scope_catalog(stmt, brand_col, user: User, brand_id: int | None = None):
    bid = effective_brand_id(user, brand_id)
    if bid is not None:
        stmt = stmt.where(or_(brand_col.is_(None), brand_col == bid))
    return stmt


def accessible_branches(db: Session, user: User, brand_id: int | None = None) -> list[Branch]:
    stmt = select(Branch).order_by(Branch.name)
    bid = effective_brand_id(user, brand_id)
    if bid is not None:
        stmt = stmt.where(Branch.brand_id == bid)
    ids = user_branch_ids(user)
    if ids is not None:
        stmt = stmt.where(Branch.id.in_(ids or [-1]))
    return list(db.scalars(stmt))


def can_access_branch(user: User, branch: Branch) -> bool:
    if user.role != "Master" and user.brand_id is not None and branch.brand_id != user.brand_id:
        return False
    ids = user_branch_ids(user)
    return ids is None or branch.id in ids


def can_create_pr(user: User) -> bool:
    if user.role not in CREATE_ROLES:
        return False
    if user.is_branch_scoped and not user.branches:
        return False
    return True


def can_edit_pr(user: User, pr: PurchaseRequest) -> bool:
    return pr.status == "Pending" and user.role in APPROVE_ROLES and can_access_branch(user, pr.branch)


def require_master(user: User) -> None:
    if user.role != "Master":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cuma Master yang boleh akses fitur ini.")


def expire_overdue(db: Session) -> int:
    result = db.execute(
        update(PurchaseRequest)
        .where(PurchaseRequest.status == "Pending")
        .where(PurchaseRequest.required_date.is_not(None))
        .where(PurchaseRequest.required_date <= today_wib())
        .values(status="Expired", updated_at=datetime.now(timezone.utc), updated_by="system (auto-expired)")
        .execution_options(synchronize_session=False)
    )
    if result.rowcount:
        db.commit()
    return result.rowcount or 0