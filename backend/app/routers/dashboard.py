from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import PR_STATUSES, ActivityLog, Branch, PurchaseOrder, PurchaseRequest, PurchaseRequestItem, User
from app.schemas import DashboardSummary, ExpiringPR, TopItem
from app.scope import accessible_branches, expire_overdue, scope_by_branch, today_wib

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def scoped(stmt, user: User, brand_id: int | None, branch_id: list[int] | None):
    stmt = scope_by_branch(stmt, PurchaseRequest.branch_id, PurchaseRequest.brand_id, user, brand_id)
    if branch_id:
        stmt = stmt.where(PurchaseRequest.branch_id.in_(branch_id))
    return stmt


@router.get("/summary", response_model=DashboardSummary)
def summary(
    brand_id: int | None = None,
    branch_id: list[int] | None = Query(None),
    date_from: date | None = None,
    date_to: date | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    expire_overdue(db)

    count_stmt = scoped(
        select(PurchaseRequest.status, func.count()).group_by(PurchaseRequest.status), user, brand_id, branch_id
    )
    if date_from:
        count_stmt = count_stmt.where(func.date(PurchaseRequest.created_at) >= date_from)
    if date_to:
        count_stmt = count_stmt.where(func.date(PurchaseRequest.created_at) <= date_to)
    counts = {s: 0 for s in PR_STATUSES}
    for s, c in db.execute(count_stmt).all():
        counts[s] = c

    tomorrow = today_wib() + timedelta(days=1)
    expiring_stmt = scoped(
        select(PurchaseRequest.id, PurchaseRequest.number, Branch.name)
        .join(Branch, Branch.id == PurchaseRequest.branch_id)
        .where(PurchaseRequest.status == "Pending", PurchaseRequest.required_date == tomorrow)
        .order_by(PurchaseRequest.number),
        user,
        brand_id,
        branch_id,
    )
    expiring = [ExpiringPR(id=i, number=n, branch=b) for i, n, b in db.execute(expiring_stmt).all()]

    def top(value_expr):
        stmt = scoped(
            select(PurchaseRequestItem.item_name, value_expr.label("v"))
            .join(PurchaseRequest, PurchaseRequest.id == PurchaseRequestItem.pr_id)
            .join(PurchaseOrder, PurchaseOrder.pr_id == PurchaseRequest.id)
            .group_by(PurchaseRequestItem.item_name)
            .order_by(value_expr.desc(), PurchaseRequestItem.item_name)
            .limit(10),
            user,
            brand_id,
            branch_id,
        )
        if date_from:
            stmt = stmt.where(func.date(PurchaseOrder.created_at) >= date_from)
        if date_to:
            stmt = stmt.where(func.date(PurchaseOrder.created_at) <= date_to)
        return [TopItem(item_name=n, value=int(v or 0)) for n, v in db.execute(stmt).all()]

    activity_stmt = select(ActivityLog).order_by(ActivityLog.created_at.desc()).limit(6)
    if not user.is_master:
        activity_stmt = activity_stmt.where(ActivityLog.user_id == user.id)

    return DashboardSummary(
        status_counts=counts,
        total=sum(counts.values()),
        expiring=expiring,
        top_by_po=top(func.count(func.distinct(PurchaseOrder.id))),
        top_by_qty=top(func.sum(PurchaseRequestItem.qty)),
        activity=db.scalars(activity_stmt).all(),
        branches=accessible_branches(db, user, brand_id),
    )