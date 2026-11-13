import argparse
import getpass
import sys

from sqlalchemy import select

from app import models
from app.database import Base, SessionLocal, engine
from app.security import hash_password


def init_db() -> None:
    Base.metadata.create_all(engine)
    print("Tabel database siap.")


def create_admin(email: str, name: str, password: str | None) -> None:
    Base.metadata.create_all(engine)
    email = email.strip().lower()
    if not password:
        password = getpass.getpass("Password admin: ")
        if password != getpass.getpass("Ulangi password: "):
            sys.exit("Password tidak sama.")
    if not 8 <= len(password.encode("utf-8")) <= 72:
        sys.exit("Password harus 8-72 karakter.")
    with SessionLocal() as db:
        user = db.scalar(select(models.User).where(models.User.email == email))
        if user:
            user.password_hash = hash_password(password)
            user.role = "admin"
            user.is_active = True
            user.token_version += 1
            print(f"User {email} sudah ada, diubah jadi admin dan password diperbarui.")
        else:
            db.add(models.User(email=email, full_name=name.strip(), role="admin", password_hash=hash_password(password)))
            print(f"Admin {email} berhasil dibuat.")
        db.commit()


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init-db")
    admin = sub.add_parser("create-admin")
    admin.add_argument("--email", required=True)
    admin.add_argument("--name", required=True)
    admin.add_argument("--password")
    args = parser.parse_args()

    if args.cmd == "init-db":
        init_db()
    elif args.cmd == "create-admin":
        create_admin(args.email, args.name, args.password)


if __name__ == "__main__":
    main()
