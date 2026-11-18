from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


DUMMY_HASH = hash_password("dummy-password-for-timing")


def create_access_token(user_id: str, token_version: int, remember: bool, sid: str | None = None) -> tuple[str, datetime]:
    now = datetime.now(timezone.utc)
    if remember:
        expires = now + timedelta(days=settings.remember_token_days)
    else:
        expires = now + timedelta(minutes=settings.access_token_minutes)
    payload = {"sub": user_id, "ver": token_version, "sid": sid, "iat": now, "exp": expires}
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, expires


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])