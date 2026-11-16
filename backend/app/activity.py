from sqlalchemy.orm import Session

from app.models import ActivityLog, User


def log_activity(db: Session, user: User | None, module: str, action: str, description: str) -> None:
    db.add(
        ActivityLog(
            user_id=user.id if user else None,
            actor_name=user.username if user else "Sistem",
            module=module,
            action=action,
            description=description,
        )
    )