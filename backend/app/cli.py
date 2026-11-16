import argparse
import getpass
import random
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, inspect, select, text

from app import models
from app.database import Base, SessionLocal, engine
from app.numbering import format_number
from app.schemas import USERNAME_PATTERN, normalize_username
from app.scope import WIB, today_wib
from app.security import hash_password

DEFAULT_BRANDS = [("KBA", "Kebuli Abuya", True), ("AFC", "Almaz Fried Chicken", False), ("DC", "Distribution Center", False)]

DEMO_BRANCHES = {
    "AFC": ["Almaz Bekasi Juanda", "Almaz Depok Margonda", "Almaz Bogor Pajajaran", "Almaz Tangerang BSD", "Almaz Jakarta Kemang"],
    "KBA": ["Kebuli Jakarta Tebet", "Kebuli Bekasi Summarecon", "Kebuli Depok Sawangan"],
}

DEMO_PRODUCTS = {
    "AFC": [("Ayam Potong", "Ekor"), ("Tepung Bumbu Crispy", "Kg"), ("Minyak Goreng", "Jerigen"), ("Saus Sambal Sachet", "Dus"), ("Paper Bag Medium", "Pack"), ("Box Nasi", "Pack")],
    "KBA": [("Beras Basmati", "Karung"), ("Daging Kambing", "Kg"), ("Bumbu Kebuli", "Pack"), ("Minyak Samin", "Kaleng"), ("Box Kebuli", "Pack")],
    None: [("Gas LPG 12kg", "Tabung"), ("Sabun Cuci Piring", "Jerigen"), ("Tisu Gulung", "Dus")],
}

DEMO_PICS = [
    ("DC Cikarang", "Direct", None),
    ("Gudang Pusat", "Direct", None),
    ("CV Sumber Pangan", "Indirect", "AFC"),
    ("PT Kemasan Prima", "Indirect", "AFC"),
]

DEMO_USERS = [
    ("sm.bekasi", "SM", "AFC", ["Almaz Bekasi Juanda"]),
    ("sm.depok", "SM", "AFC", ["Almaz Depok Margonda"]),
    ("am.afc", "AM", "AFC", ["Almaz Bekasi Juanda", "Almaz Depok Margonda", "Almaz Bogor Pajajaran"]),
    ("amka.kba", "AMKA", "KBA", ["Kebuli Jakarta Tebet", "Kebuli Bekasi Summarecon", "Kebuli Depok Sawangan"]),
    ("pic.afc", "PIC", "AFC", []),
    ("pic.kba", "PIC", "KBA", []),
]

DEMO_PASSWORD = "password123"


def ensure_default_brands(db) -> dict[str, models.Brand]:
    out = {}
    for code, name, direct_only in DEFAULT_BRANDS:
        brand = db.scalar(select(models.Brand).where(models.Brand.code == code))
        if brand is None:
            brand = models.Brand(code=code, name=name, direct_only=direct_only)
            db.add(brand)
            db.flush()
        out[code] = brand
    return out


UNIQUE_RULES = [
    ("products", "uq_products_name_unit_brand", ["name", "unit", "brand_id"]),
    ("pics", "uq_pics_name_shipping_brand", ["name", "shipping", "brand_id"]),
]


def sync_unique_constraints() -> list[str]:
    if engine.dialect.name != "postgresql":
        return []
    changes = []
    with engine.begin() as conn:
        insp = inspect(conn)
        for table, keep, cols in UNIQUE_RULES:
            if not insp.has_table(table):
                continue
            has_keep = False
            for uc in insp.get_unique_constraints(table):
                if uc["name"] == keep and list(uc["column_names"]) == cols:
                    has_keep = True
                    continue
                conn.execute(text(f'ALTER TABLE "{table}" DROP CONSTRAINT "{uc["name"]}"'))
                changes.append(f"{table}: hapus constraint lama {uc['name']} ({', '.join(uc['column_names'])})")
            constraint_names = {uc["name"] for uc in insp.get_unique_constraints(table)}
            for ix in insp.get_indexes(table):
                if ix.get("unique") and ix["name"] not in constraint_names and ix["name"] != keep:
                    conn.execute(text(f'DROP INDEX IF EXISTS "{ix["name"]}"'))
                    changes.append(f"{table}: hapus index unik lama {ix['name']} ({', '.join(c for c in ix['column_names'] if c)})")
            if not has_keep:
                col_sql = ", ".join(f'"{c}"' for c in cols)
                conn.execute(text(f'ALTER TABLE "{table}" ADD CONSTRAINT "{keep}" UNIQUE ({col_sql})'))
                changes.append(f"{table}: tambah constraint {keep} ({', '.join(cols)})")
    return changes


def init_db() -> None:
    Base.metadata.create_all(engine)
    for line in sync_unique_constraints():
        print(line)
    with SessionLocal() as db:
        ensure_default_brands(db)
        db.commit()
    print("Tabel database siap.")


def reset_db(confirm: bool) -> None:
    if not confirm:
        answer = input("Semua data di database akan DIHAPUS. Ketik HAPUS untuk lanjut: ")
        if answer.strip() != "HAPUS":
            sys.exit("Dibatalkan.")
    Base.metadata.drop_all(engine)
    init_db()
    print("Database sudah di-reset.")


def create_master(username: str, password: str | None) -> None:
    import re

    init_db()
    username = normalize_username(username)
    if not re.match(USERNAME_PATTERN, username):
        sys.exit("Username harus 3-50 karakter: huruf kecil, angka, titik, strip, atau underscore.")
    if not password:
        password = getpass.getpass("Password: ")
        if password != getpass.getpass("Ulangi password: "):
            sys.exit("Password tidak sama.")
    if not 6 <= len(password.encode("utf-8")) <= 72:
        sys.exit("Password harus 6-72 karakter.")
    with SessionLocal() as db:
        user = db.scalar(select(models.User).where(models.User.username == username))
        if user:
            user.password_hash = hash_password(password)
            user.role = "Master"
            user.brand_id = None
            user.branches = []
            user.is_active = True
            user.failed_attempts = 0
            user.locked_until = None
            user.token_version += 1
            print(f"User {username} sudah ada, dijadikan Master dan password diperbarui.")
        else:
            db.add(models.User(username=username, role="Master", password_hash=hash_password(password)))
            print(f"Master {username} berhasil dibuat.")
        db.commit()


def seed_demo() -> None:
    init_db()
    with SessionLocal() as db:
        if db.scalar(select(func.count()).select_from(models.PurchaseRequest)):
            print("Sudah ada data PR, seed demo dilewati.")
            return

        rng = random.Random(7)
        brands = ensure_default_brands(db)

        branches = {}
        for code, names in DEMO_BRANCHES.items():
            for i, name in enumerate(names, start=1):
                branch = db.scalar(select(models.Branch).where(models.Branch.name == name))
                if branch is None:
                    branch = models.Branch(code=f"{code}{i:02d}", name=name, brand_id=brands[code].id)
                    db.add(branch)
                    db.flush()
                branches[name] = branch

        products = defaultdict(list)
        for code, rows in DEMO_PRODUCTS.items():
            for name, unit in rows:
                product = db.scalar(select(models.Product).where(models.Product.name == name, models.Product.unit == unit))
                if product is None:
                    product = models.Product(name=name, unit=unit, brand_id=brands[code].id if code else None)
                    db.add(product)
                    db.flush()
                products[code].append(product)

        pics = []
        for name, shipping, code in DEMO_PICS:
            pic = db.scalar(select(models.Pic).where(models.Pic.name == name))
            if pic is None:
                pic = models.Pic(name=name, shipping=shipping, brand_id=brands[code].id if code else None)
                db.add(pic)
                db.flush()
            pics.append(pic)

        for username, role, code, branch_names in DEMO_USERS:
            if db.scalar(select(models.User).where(models.User.username == username)):
                continue
            db.add(
                models.User(
                    username=username,
                    role=role,
                    brand_id=brands[code].id,
                    password_hash=hash_password(DEMO_PASSWORD),
                    branches=[branches[n] for n in branch_names],
                )
            )
        db.flush()

        now = datetime.now(timezone.utc)
        today = today_wib()
        seq = defaultdict(int)

        def number(prefix: str, when: datetime) -> str:
            d = when.astimezone(WIB).date()
            seq[(d, prefix)] += 1
            return format_number(prefix, d, seq[(d, prefix)])

        plan = []
        for _ in range(45):
            outcome = rng.choices(["Pending", "Approved", "Rejected", "Expired"], weights=[5, 6, 1, 2])[0]
            if outcome == "Pending":
                created = now - timedelta(days=rng.randint(0, 2), hours=rng.randint(0, 20), minutes=rng.randint(0, 59))
            else:
                created = now - timedelta(days=rng.randint(2, 30), hours=rng.randint(0, 20), minutes=rng.randint(0, 59))
            plan.append((created, outcome))
        plan.sort(key=lambda x: x[0])

        made = {"Pending": 0, "Approved": 0, "Rejected": 0, "Expired": 0}
        for created, outcome in plan:
            branch = rng.choice(list(branches.values()))
            code = "KBA" if branch.brand_id == brands["KBA"].id else "AFC"
            shipping = "Direct" if code == "KBA" else rng.choice(["Direct", "Indirect"])
            pic_choices = [p for p in pics if p.shipping == shipping and (p.brand_id in (None, branch.brand_id))]
            created_day = created.astimezone(WIB).date()
            if outcome == "Pending":
                required = today + timedelta(days=rng.randint(1, 7))
            elif outcome == "Expired":
                required = min(created_day + timedelta(days=rng.randint(1, 3)), today)
            else:
                required = created_day + timedelta(days=rng.randint(2, 7))
            status = outcome

            pool = products[code] + products[None]
            chosen = rng.sample(pool, k=rng.randint(1, 4))
            pr = models.PurchaseRequest(
                number=number("PR", created),
                branch_id=branch.id,
                brand_id=branch.brand_id,
                shipping_category=shipping,
                pic=rng.choice(pic_choices).name,
                required_date=required,
                notes=rng.choice([None, "Stok menipis", "Untuk promo akhir pekan", "Urgent, mohon dipercepat"]),
                status=status,
                created_by=rng.choice(["sm.bekasi", "sm.depok", "amka.kba"]),
                created_at=created,
                items=[models.PurchaseRequestItem(product_id=p.id, item_name=p.display_name, qty=rng.randint(1, 30)) for p in chosen],
            )
            if status != "Pending":
                pr.updated_at = created + timedelta(hours=rng.randint(1, 20))
                pr.updated_by = "system (auto-expired)" if status == "Expired" else rng.choice(["am.afc", "amka.kba"])
            db.add(pr)
            db.flush()
            if status == "Approved":
                po_time = min(pr.updated_at, now)
                db.add(models.PurchaseOrder(number=number("PO", po_time), pr_id=pr.id, created_by=pr.updated_by, created_at=po_time))
            made[status] += 1

        for (d, prefix), last in seq.items():
            db.merge(models.DocumentCounter(doc_date=d, prefix=prefix, last_seq=last))

        db.commit()
        print(f"Data demo dibuat: {len(branches)} cabang, {sum(len(v) for v in products.values())} produk, {len(pics)} PIC, {len(DEMO_USERS)} user, PR {made}.")
        print(f"Password semua user demo: {DEMO_PASSWORD}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init-db")
    reset = sub.add_parser("reset-db")
    reset.add_argument("--yes", action="store_true")
    sub.add_parser("seed-demo")
    master = sub.add_parser("create-master")
    master.add_argument("--username", required=True)
    master.add_argument("--password")
    args = parser.parse_args()

    if args.cmd == "init-db":
        init_db()
    elif args.cmd == "reset-db":
        reset_db(args.yes)
    elif args.cmd == "seed-demo":
        seed_demo()
    elif args.cmd == "create-master":
        create_master(args.username, args.password)


if __name__ == "__main__":
    main()