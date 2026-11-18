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


def widen_role_column() -> list[str]:
    if engine.dialect.name != "postgresql":
        return []
    with engine.begin() as conn:
        insp = inspect(conn)
        if not insp.has_table("users"):
            return []
        col = next((c for c in insp.get_columns("users") if c["name"] == "role"), None)
        length = getattr(col["type"], "length", None) if col else None
        if length is not None and length < 50:
            conn.execute(text('ALTER TABLE "users" ALTER COLUMN "role" TYPE VARCHAR(50)'))
            return ["users: kolom role diperlebar jadi 50 karakter"]
    return []


NEW_COLUMNS = [
    ("activity_logs", "brand_id", "INTEGER REFERENCES brands(id) ON DELETE SET NULL"),
    ("activity_logs", "ref", "VARCHAR(60)"),
    ("users", "session_token", "VARCHAR(64)"),
    ("users", "session_seen_at", "TIMESTAMP WITH TIME ZONE"),
    ("users", "session_device", "VARCHAR(120)"),
    ("branches", "wh_code", "VARCHAR(1)"),
]


def add_missing_columns() -> list[str]:
    changes = []
    with engine.begin() as conn:
        insp = inspect(conn)
        for table, col, ddl in NEW_COLUMNS:
            if not insp.has_table(table):
                continue
            if any(c["name"] == col for c in insp.get_columns(table)):
                continue
            conn.execute(text(f'ALTER TABLE "{table}" ADD COLUMN "{col}" {ddl}'))
            conn.execute(text(f'CREATE INDEX IF NOT EXISTS "ix_{table}_{col}" ON "{table}" ("{col}")'))
            changes.append(f"{table}: tambah kolom {col}")
    return changes


def sync_schema() -> list[str]:
    return sync_unique_constraints() + widen_role_column() + add_missing_columns()


ONE_TIME_GRANTS = [("grant_log_view", "log.view")]


def apply_one_time_grants(db) -> list[str]:
    changes = []
    for key, perm in ONE_TIME_GRANTS:
        if db.get(models.AppSetting, key) is not None:
            continue
        for r in db.scalars(select(models.Role)).all():
            perms = set(r.permissions or [])
            if perm not in perms:
                perms.add(perm)
                r.permissions = [k for k in models.PERMISSIONS if k in perms]
                changes.append(f"roles: {r.name} dapat hak akses {models.PERMISSIONS[perm]}")
        db.add(models.AppSetting(key=key, value="done"))
    db.flush()
    return changes


def ensure_default_roles(db) -> list[str]:
    changes = []
    if db.scalar(select(func.count()).select_from(models.Role)):
        if db.scalar(select(models.Role).where(models.Role.name == models.MASTER_ROLE)) is None:
            db.add(models.Role(name=models.MASTER_ROLE, permissions=list(models.PERMISSIONS)))
    else:
        for name, perms in models.DEFAULT_ROLES:
            db.add(models.Role(name=name, permissions=perms))
        db.flush()
        return changes
    roles = db.scalars(select(models.Role)).all()
    if not any(k in models.OLD_PERMISSION_KEYS for r in roles for k in (r.permissions or [])):
        return changes
    for r in roles:
        perms = {models.OLD_PERMISSION_KEYS.get(k, k) for k in (r.permissions or [])}
        perms.update(("pr.view", "po.view"))
        r.permissions = [k for k in models.PERMISSIONS if k in perms]
        changes.append(f"roles: hak akses {r.name} dipindah ke format baru")
    db.flush()
    return changes


def init_db() -> None:
    Base.metadata.create_all(engine)
    for line in sync_schema():
        print(line)
    with SessionLocal() as db:
        ensure_default_brands(db)
        for line in ensure_default_roles(db) + apply_one_time_grants(db):
            print(line)
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


WH_DEMO_DCS = [("DCA", "DC A Cikarang", "A"), ("DCB", "DC B Cibitung", "B")]
WH_DEMO_LAYOUT = {
    "Zona Dry": ["Rak 01", "Rak 02", "Rak 03"],
    "Zona Chiller": ["Chiller 01", "Chiller 02"],
    "Zona Frozen": ["Freezer 01"],
}
WH_DEMO_PRODUCTS = [
    ("Tepung Bumbu Original 1kg", "Bumbu", "Tepung", "Pack"),
    ("Tepung Bumbu Pedas 1kg", "Bumbu", "Tepung", "Pack"),
    ("Minyak Goreng 18L", "Minyak", "Minyak", "Jerigen"),
    ("Saus Sambal 5kg", "Saus", "Sambal", "Galon"),
    ("Saus Tomat 5kg", "Saus", "Tomat", "Galon"),
    ("Mayonnaise 1kg", "Saus", "Mayo", "Pack"),
    ("Keju Slice 84pcs", "Dairy", "Keju", "Pack"),
    ("Susu UHT 1L", "Dairy", "Susu", "Karton"),
    ("Ayam Potong 9pcs", "Frozen", "Ayam", "Box"),
    ("Kentang Goreng 2.5kg", "Frozen", "Kentang", "Pack"),
    ("Nugget Ayam 1kg", "Frozen", "Olahan", "Pack"),
    ("Paper Box Ayam", "Packaging", "Box", "Ikat"),
    ("Cup Saus 1oz", "Packaging", "Cup", "Slop"),
    ("Kantong Plastik L", "Packaging", "Plastik", "Pack"),
]
WH_DEMO_ROLES = [
    ("Admin DC", [
        "wh.session.view", "wh.session.create", "wh.session.update", "wh.session.delete", "wh.count.input", "wh.final.approve",
        "wh.structure.view", "wh.structure.create", "wh.structure.update", "wh.structure.delete",
        "wh.product.view", "wh.product.create", "wh.product.update", "wh.product.delete",
        "wh.data.import", "wh.data.export", "branch.all", "log.view",
    ]),
    ("Checker DC", ["wh.session.view", "wh.count.input", "wh.structure.view", "wh.product.view", "log.view"]),
]
WH_DEMO_USERS = [("admin.dc", "Admin DC", []), ("checker.dca", "Checker DC", ["DC A Cikarang"]), ("checker.dcb", "Checker DC", ["DC B Cibitung"])]


BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]


def seed_wh_demo() -> None:
    init_db()
    with SessionLocal() as db:
        if db.scalar(select(func.count()).select_from(models.WhSession)):
            print("Sudah ada sesi stock opname, seed demo gudang dilewati.")
            return
        rng = random.Random(11)
        brands = ensure_default_brands(db)
        dc_brand = brands[models.WH_BRAND_CODE]
        for name, perms in WH_DEMO_ROLES:
            if db.scalar(select(models.Role).where(models.Role.name == name)) is None:
                db.add(models.Role(name=name, brand_id=dc_brand.id, permissions=[p for p in models.PERMISSIONS if p in perms]))
        dcs = {}
        for code, name, letter in WH_DEMO_DCS:
            dc = db.scalar(select(models.Branch).where(models.Branch.name == name))
            if dc is None:
                dc = models.Branch(code=code, name=name, brand_id=dc_brand.id, wh_code=letter)
                db.add(dc)
                db.flush()
            dcs[name] = dc
        db.flush()
        for username, role, branch_names in WH_DEMO_USERS:
            if db.scalar(select(models.User).where(models.User.username == username)) is None:
                db.add(models.User(username=username, role=role, brand_id=dc_brand.id, password_hash=hash_password(DEMO_PASSWORD), branches=[dcs[n] for n in branch_names]))
        made_products = 0
        for dc in dcs.values():
            products = []
            for i, (pname, cat, sub, unit) in enumerate(WH_DEMO_PRODUCTS, start=1):
                barcode = f"{dc.wh_code}{i:05d}"
                p = db.get(models.WhProduct, barcode)
                if p is None:
                    p = models.WhProduct(barcode=barcode, branch_id=dc.id, name=pname, product_code=f"SKU-{i:03d}", category=cat, sub_category=sub, unit=unit)
                    db.add(p)
                    made_products += 1
                products.append(p)
            db.flush()
            pool = list(products)
            rng.shuffle(pool)
            for zname, sectors in WH_DEMO_LAYOUT.items():
                zone = models.WhZone(branch_id=dc.id, name=zname)
                db.add(zone)
                db.flush()
                for sname in sectors:
                    sector = models.WhSector(zone_id=zone.id, name=sname)
                    db.add(sector)
                    db.flush()
                    for seq, p in enumerate(rng.sample(pool, k=4), start=1):
                        db.add(models.WhPlacement(sector_id=sector.id, barcode=p.barcode, sequence=seq))
            db.flush()
            today = today_wib()
            last_month = (today.replace(day=1) - timedelta(days=1)).replace(day=28)
            done = models.WhSession(branch_id=dc.id, name=f"SO {BULAN[last_month.month - 1]} {last_month.year}", session_date=last_month, status="Final", created_by="admin.dc", finalized_by="admin.dc", finalized_at=datetime.now(timezone.utc) - timedelta(days=10))
            current = models.WhSession(branch_id=dc.id, name=f"SO {BULAN[today.month - 1]} {today.year}", session_date=today, status="Aktif", created_by="admin.dc")
            db.add_all([done, current])
            db.flush()
            placements = db.execute(
                select(models.WhPlacement.sector_id, models.WhPlacement.barcode)
                .join(models.WhSector, models.WhSector.id == models.WhPlacement.sector_id)
                .join(models.WhZone, models.WhZone.id == models.WhSector.zone_id)
                .where(models.WhZone.branch_id == dc.id)
            ).all()
            checker = "checker.dca" if dc.wh_code == "A" else "checker.dcb"
            totals = defaultdict(float)
            for sector_id, barcode in placements:
                qty = rng.randint(3, 120)
                db.add(models.WhCount(session_id=done.id, sector_id=sector_id, barcode=barcode, qty=qty, updated_by=checker))
                totals[barcode] += qty
                if rng.random() < 0.55:
                    db.add(models.WhCount(session_id=current.id, sector_id=sector_id, barcode=barcode, qty=rng.randint(3, 120), updated_by=checker))
            for barcode, qty in totals.items():
                adj = qty if rng.random() < 0.85 else max(0, qty - rng.randint(1, 5))
                db.add(models.WhFinal(session_id=done.id, barcode=barcode, qty_count=qty, qty_final=adj))
        db.commit()
        print(f"Data demo gudang dibuat: {len(dcs)} DC, {made_products} produk gudang, role Admin DC & Checker DC, user {', '.join(u for u, _, _ in WH_DEMO_USERS)}.")
        print(f"Password user demo gudang: {DEMO_PASSWORD}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init-db")
    reset = sub.add_parser("reset-db")
    reset.add_argument("--yes", action="store_true")
    sub.add_parser("seed-demo")
    sub.add_parser("seed-wh-demo")
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
    elif args.cmd == "seed-wh-demo":
        seed_wh_demo()
    elif args.cmd == "create-master":
        create_master(args.username, args.password)


if __name__ == "__main__":
    main()