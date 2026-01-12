from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db import get_db

router = APIRouter(prefix="/seed", tags=["dev-seed"])


def _table_columns(db: Session, table_name: str) -> List[str]:
    q = text(
        """
        select column_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name = :t
        order by ordinal_position
        """
    )
    return [r[0] for r in db.execute(q, {"t": table_name}).all()]


def _insert_returning_id(db: Session, table: str, values: Dict[str, Any]) -> int:
    cols = _table_columns(db, table)
    usable = {k: v for k, v in values.items() if k in cols}
    if not usable:
        raise HTTPException(
            status_code=500,
            detail=f"Seed failed: no usable columns for insert into {table}",
        )

    col_list = ", ".join(usable.keys())
    val_list = ", ".join([f":{k}" for k in usable.keys()])
    sql = text(f"insert into {table} ({col_list}) values ({val_list}) returning id")
    new_id = db.execute(sql, usable).scalar()
    if not new_id:
        raise HTTPException(
            status_code=500,
            detail=f"Seed failed: insert into {table} did not return an id",
        )
    return int(new_id)


def _fk_target_table(db: Session, table: str, column: str) -> str:
    """
    Return the referenced table name for a FK on (table.column).
    Example: applications.event_id -> events_backup
    """
    q = text(
        """
        select ccu.table_name as ref_table
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on tc.constraint_name = kcu.constraint_name
         and tc.table_schema = kcu.table_schema
        join information_schema.constraint_column_usage ccu
          on ccu.constraint_name = tc.constraint_name
         and ccu.table_schema = tc.table_schema
        where tc.table_schema = 'public'
          and tc.table_name = :table
          and tc.constraint_type = 'FOREIGN KEY'
          and kcu.column_name = :col
        limit 1
        """
    )
    ref = db.execute(q, {"table": table, "col": column}).scalar()
    if not ref:
        raise HTTPException(
            status_code=500,
            detail=f"Seed failed: could not find FK target for {table}.{column}",
        )
    return str(ref)


@router.post("", status_code=status.HTTP_201_CREATED)
def seed_demo(db: Session = Depends(get_db)):
    """
    Seed that follows the DB schema as-is (even after resets):
    - application uses applications.user_id + slot_request
    - applications.event_id FK target table may be events or events_backup
    - vendor_profile reused/created in vendor_profiles (unique on user_id)
    """
    try:
        uid = db.execute(
            text("select id from public.users order by id desc limit 1")
        ).scalar()
        if not uid:
            raise HTTPException(
                status_code=400, detail="No users found; create a user first."
            )
        uid = int(uid)

        # vendor_profiles reuse/create
        existing_vid = db.execute(
            text("select id from vendor_profiles where user_id = :uid limit 1"),
            {"uid": uid},
        ).scalar()

        if existing_vid:
            vendor_profile_id = int(existing_vid)
            vendor_profile_created = False
        else:
            vendor_profile_id = _insert_returning_id(
                db,
                "vendor_profiles",
                {
                    "business_name": "Seed Vendor",
                    "contact_name": "Seed Contact",
                    "phone": "555-0101",
                    "website": "https://example.com",
                    "about": "Seeded vendor profile",
                    "user_id": uid,
                },
            )
            vendor_profile_created = True

        # IMPORTANT: follow FK target for applications.event_id
        events_table = _fk_target_table(db, "applications", "event_id")

        event_id = _insert_returning_id(
            db,
            events_table,
            {
                "organizer_id": uid,
                "title": "Seed Event",
                "date": datetime.now() + timedelta(days=30),
                "location": "Town Hall",
                "description": "Seeded event",
                "city": "Atlanta",
                "max_vendor_slots": 50,
            },
        )

        # applications table uses user_id + slot_request (your schema)
        app_cols = set(_table_columns(db, "applications"))
        payload: Dict[str, Any] = {
            "event_id": event_id,
            "user_id": uid,
            "slot_request": 1,
            "notes": "seed",
            "status": "pending",
            "total_due_cents": 20000,
        }

        # drop any keys not in table
        payload = {k: v for k, v in payload.items() if k in app_cols}

        application_id = _insert_returning_id(db, "applications", payload)

        db.commit()
        return {
            "user_id": uid,
            "vendor_profile_id": vendor_profile_id,
            "vendor_profile_created": vendor_profile_created,
            "events_table_used": events_table,
            "event_id": event_id,
            "application_id": application_id,
        }

    except HTTPException:
        raise
    except SQLAlchemyError as e:
        db.rollback()
        raise HTTPException(
            status_code=500, detail=f"Seed failed (db): {type(e).__name__}: {e}"
        )
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500, detail=f"Seed failed: {type(e).__name__}: {e}"
        )
