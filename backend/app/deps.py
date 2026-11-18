import uuid
from datetime import timedelta

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import User, as_utc, utcnow
from app.scope import require_master
from app.security import decode_access_token

bearer = HTTPBearer(auto_error=False)


def unauthorized(detail: str = "Sesi tidak valid. Silakan login ulang.") -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail, headers={"WWW-Authenticate": "Bearer"})


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise unauthorized("Belum login.")
    try:
        payload = decode_access_token(credentials.credentials)
        user_id = uuid.UUID(payload["sub"])
    except jwt.ExpiredSignatureError:
        raise unauthorized("Sesi sudah berakhir. Silakan login ulang.")
    except (jwt.PyJWTError, KeyError, ValueError):
        raise unauthorized()
    user = db.get(User, user_id)
    if user is None or not user.is_active or payload.get("ver") != user.token_version:
        raise unauthorized()
    sid = payload.get("sid")
    if not sid or sid != user.session_token:
        raise unauthorized("Sesi kamu sudah ditutup (logout dari perangkat ini, dipaksa keluar oleh Master, atau akun dipakai di perangkat lain). Silakan login lagi.")
    seen = as_utc(user.session_seen_at)
    now = utcnow()
    if seen is None or now - seen >= timedelta(minutes=settings.session_idle_minutes):
        db.execute(update(User).where(User.id == user.id).values(session_token=None, updated_at=User.updated_at))
        db.commit()
        raise unauthorized(f"Sesi berakhir karena tidak ada aktivitas lebih dari {settings.session_idle_minutes} menit. Silakan login lagi.")
    if now - seen >= timedelta(seconds=60):
        db.execute(update(User).where(User.id == user.id).values(session_seen_at=now, updated_at=User.updated_at))
        db.commit()
        db.refresh(user)
    return user


def get_master(user: User = Depends(get_current_user)) -> User:
    require_master(user)
    return user