# ADD THIS near the other imports at the top if not already present
from typing import Literal

# ...

# ── list applications for an event (with vendor & slot details) ───────────────
@router.get("/event/{event_id}")
def list_applications_for_event(
    event_id: int,
    status: Literal["submitted", "approved", "declined"] | None = None,
    db: Session = Depends(get_db),
):
    """
    Returns all applications for an event with vendor & slot details.
    Optional ?status=submitted|approved|declined filter.
    """
    base_sql = """
        SELECT
          a.id,
          a.event_id,
          a.vendor_id,
          a.slot_id,
          a.status,
          a.price_cents,
          a.desired_location,
          a.notes,
          a.payment_ref,
          a.paid_at,
          a.created_at,
          a.updated_at,

          -- vendor bits
          v.name          AS vendor_name,
          v.category      AS vendor_category,
          v.phone         AS vendor_phone,
          v.description   AS vendor_description,

          -- slot bits (nullable)
          s.label         AS slot_label,
          s.price_cents   AS slot_price_cents,
          s.status        AS slot_status
        FROM public.applications a
        LEFT JOIN public.vendors      v ON v.id  = a.vendor_id
        LEFT JOIN public.event_slots  s ON s.id  = a.slot_id
        WHERE a.event_id = :eid
    """
    params = {"eid": event_id}
    if status:
        base_sql += "  AND a.status = :status"
        params["status"] = status

    base_sql += " ORDER BY a.created_at DESC, a.id DESC"

    rows = db.execute(sa.text(base_sql), params).mappings().all()
    return [dict(r) for r in rows]
