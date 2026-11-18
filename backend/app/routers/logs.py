from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import BRAND_LOG_MODULES, LOG_MODULES, ActivityLog, User
from app.schemas import LogList

router = APIRouter(prefix="/api/logs", tags=["logs"])


def visible_modules(user: User) -> dict[str, str]:
    if user.is_master:
        return dict(LOG_MODULES)
    return {k: v for k, v in LOG_MODULES.items() if k in BRAND_LOG_MODULES}


def scoped(stmt, user: User, brand_id: int | None):
    mods = list(visible_modules(user))
    stmt = stmt.where(ActivityLog.module.in_(mods))
    if user.is_master:
        if brand_id is not None:
            stmt = stmt.where(or_(ActivityLog.brand_id == brand_id, ActivityLog.brand_id.is_(None)))
        return stmt
    if user.brand_id is None:
        return stmt.where(ActivityLog.id == -1)
    return stmt.where(ActivityLog.brand_id == user.brand_id)


@router.get("", response_model=LogList)
def list_logs(
    module: str | None = None,
    q: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    brand_id: int | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not user.can("log.view"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Role kamu tidak punya akses melihat Log.")
    modules = visible_modules(user)
    if module and module not in modules:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Modul log tidak dikenal.")

    filters = scoped(select(ActivityLog), user, brand_id)
    if date_from:
        filters = filters.where(func.date(ActivityLog.created_at) >= date_from)
    if date_to:
        filters = filters.where(func.date(ActivityLog.created_at) <= date_to)
    if q and q.strip():
        like = f"%{q.strip().lower()}%"
        filters = filters.where(
            or_(
                func.lower(ActivityLog.actor_name).like(like),
                func.lower(ActivityLog.description).like(like),
                func.lower(func.coalesce(ActivityLog.ref, "")).like(like),
            )
        )

    sub = filters.subquery()
    by_module = {m: 0 for m in modules}
    for m, c in db.execute(select(sub.c.module, func.count()).group_by(sub.c.module)).all():
        by_module[m] = c

    stmt = filters.where(ActivityLog.module == module) if module else filters
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = db.scalars(stmt.order_by(ActivityLog.created_at.desc(), ActivityLog.id.desc()).offset((page - 1) * size).limit(size)).all()
    return LogList(items=items, total=total, page=page, size=size, by_module=by_module, modules=modules)