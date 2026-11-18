import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.activity import log_activity
from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.models import User, as_utc, utcnow
from app.scope import WIB
from app.schemas import LoginIn, PasswordChange, TokenOut, UserOut, normalize_username
from app.security import DUMMY_HASH, create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])

INVALID_LOGIN = "Username atau password salah."


def device_label(request: Request) -> str:
    ua = request.headers.get("user-agent", "")
    os_name = next((n for k, n in (("Android", "Android"), ("iPhone", "iPhone"), ("iPad", "iPad"), ("Windows", "Windows"), ("Mac OS", "Mac"), ("Linux", "Linux")) if k in ua), "")
    browser = next((n for k, n in (("Edg/", "Edge"), ("OPR/", "Opera"), ("SamsungBrowser", "Samsung Internet"), ("Firefox/", "Firefox"), ("Chrome/", "Chrome"), ("Safari/", "Safari")) if k in ua), "")
    label = " di ".join(x for x in (browser, os_name) if x)
    return (label or "perangkat lain")[:120]


def issue_token(user: User, remember: bool) -> TokenOut:
    token, expires = create_access_token(str(user.id), user.token_version, remember, user.session_token)
    return TokenOut(access_token=token, expires_at=expires, user=UserOut.model_validate(user))


@router.post("/login", response_model=TokenOut)
def login(data: LoginIn, request: Request, db: Session = Depends(get_db)):
    raw = normalize_username(data.username)
    if raw != raw.lower():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username harus huruf kecil semua.")

    user = db.scalar(select(User).where(User.username == raw))
    if user is None:
        verify_password(data.password, DUMMY_HASH)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_LOGIN)

    locked_until = as_utc(user.locked_until)
    if locked_until and locked_until > utcnow():
        minutes = max(1, int((locked_until - utcnow()).total_seconds() // 60) + 1)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Akun dikunci sementara karena terlalu banyak percobaan. Coba lagi dalam {minutes} menit.",
        )

    if not verify_password(data.password, user.password_hash):
        user.failed_attempts += 1
        if user.failed_attempts >= settings.login_max_attempts:
            user.locked_until = utcnow() + timedelta(minutes=settings.login_lock_minutes)
            user.failed_attempts = 0
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_LOGIN)

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Akun kamu dinonaktifkan. Hubungi Master.")

    if user.session_active:
        since = as_utc(user.last_login_at)
        since_txt = since.astimezone(WIB).strftime("%H:%M") if since else "-"
        free_at = (as_utc(user.session_seen_at) + timedelta(minutes=settings.session_idle_minutes)).astimezone(WIB).strftime("%H:%M")
        user.failed_attempts = 0
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Akun ini sedang aktif di perangkat lain ({user.session_device or 'perangkat lain'}, login jam {since_txt}). "
                f"Logout dulu dari perangkat itu, tunggu sampai sekitar jam {free_at} kalau perangkat itu tidak dipakai, "
                "atau minta Master untuk Paksa Logout."
            ),
        )

    user.failed_attempts = 0
    user.locked_until = None
    user.last_login_at = utcnow()
    user.session_token = secrets.token_urlsafe(32)
    user.session_seen_at = utcnow()
    user.session_device = device_label(request)
    log_activity(db, user, "auth", "login", "masuk ke sistem", brand_id=user.brand_id)
    db.commit()
    db.refresh(user)
    return issue_token(user, data.remember)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.post("/change-password", response_model=TokenOut)
def change_password(data: PasswordChange, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password lama salah.")
    if data.current_password == data.new_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password baru harus beda dari yang lama.")
    user.password_hash = hash_password(data.new_password)
    user.token_version += 1
    log_activity(db, user, "auth", "change_password", "mengganti password", brand_id=user.brand_id)
    db.commit()
    db.refresh(user)
    return issue_token(user, False)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user.session_token = None
    user.session_seen_at = None
    log_activity(db, user, "auth", "logout", "keluar dari sistem", brand_id=user.brand_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)