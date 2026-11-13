from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import ActivityLog, User
from app.schemas import DashboardStats, DashboardSummary

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/summary", response_model=DashboardSummary)
def summary(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stmt = select(ActivityLog).order_by(ActivityLog.created_at.desc()).limit(6)
    if user.role != "admin":
        stmt = stmt.where(ActivityLog.user_id == user.id)
    activity = db.scalars(stmt).all()
    return DashboardSummary(stats=DashboardStats(), activity=activity, branches=user.branches)
