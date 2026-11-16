from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.models import DocumentCounter
from app.scope import today_wib


def format_number(prefix: str, doc_date, seq: int) -> str:
    return f"{prefix}-{doc_date:%Y%m%d}-{seq:03d}"


def next_number(db: Session, prefix: str) -> str:
    doc_date = today_wib()
    dialect = db.get_bind().dialect.name
    insert = pg_insert if dialect == "postgresql" else sqlite_insert
    stmt = (
        insert(DocumentCounter)
        .values(doc_date=doc_date, prefix=prefix, last_seq=1)
        .on_conflict_do_update(
            index_elements=[DocumentCounter.doc_date, DocumentCounter.prefix],
            set_={"last_seq": DocumentCounter.last_seq + 1},
        )
        .returning(DocumentCounter.last_seq)
    )
    seq = db.execute(stmt).scalar_one()
    return format_number(prefix, doc_date, seq)


def peek_last(db: Session, prefix: str) -> int:
    return db.scalar(
        select(DocumentCounter.last_seq).where(DocumentCounter.doc_date == today_wib(), DocumentCounter.prefix == prefix)
    ) or 0