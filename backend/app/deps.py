import uuid

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
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
    return user


def get_master(user: User = Depends(get_current_user)) -> User:
    require_master(user)
    return user