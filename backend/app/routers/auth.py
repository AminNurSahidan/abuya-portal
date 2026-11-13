from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.activity import log_activity
from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.models import User, as_utc, utcnow
from app.schemas import LoginIn, PasswordChange, ProfileUpdate, TokenOut, UserOut
from app.security import DUMMY_HASH, create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])

INVALID_LOGIN = "Email atau kata sandi salah."


def issue_token(user: User, remember: bool) -> TokenOut:
    token, expires = create_access_token(str(user.id), user.token_version, remember)
    return TokenOut(access_token=token, expires_at=expires, user=UserOut.model_validate(user))


@router.post("/login", response_model=TokenOut)
def login(data: LoginIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == data.email.lower()))

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
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Akun kamu dinonaktifkan. Hubungi admin.")

    user.failed_attempts = 0
    user.locked_until = None
    user.last_login_at = utcnow()
    log_activity(db, user, "auth", "login", "masuk ke sistem")
    db.commit()
    db.refresh(user)
    return issue_token(user, data.remember)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.patch("/me", response_model=UserOut)
def update_me(data: ProfileUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user.full_name = data.full_name.strip()
    log_activity(db, user, "users", "update_profile", "memperbarui profil")
    db.commit()
    db.refresh(user)
    return user


@router.post("/change-password", response_model=TokenOut)
def change_password(data: PasswordChange, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Kata sandi lama salah.")
    if data.current_password == data.new_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Kata sandi baru harus berbeda dari yang lama.")
    user.password_hash = hash_password(data.new_password)
    user.token_version += 1
    log_activity(db, user, "auth", "change_password", "mengganti kata sandi")
    db.commit()
    db.refresh(user)
    return issue_token(user, False)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    log_activity(db, user, "auth", "logout", "keluar dari sistem")
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
def logout_all(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user.token_version += 1
    log_activity(db, user, "auth", "logout_all", "keluar dari semua perangkat")
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
