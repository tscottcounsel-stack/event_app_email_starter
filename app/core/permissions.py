from fastapi import HTTPException

from app.core.plans import PLAN_FEATURES


ACTIVE_SUBSCRIPTION_STATUSES = {"active", "trialing"}


def get_plan_features(plan: str) -> dict:
    return PLAN_FEATURES.get((plan or "").strip().lower(), PLAN_FEATURES["starter"])


def is_paid_active(user: dict) -> bool:
    status = str(user.get("subscription_status") or "").strip().lower()
    return status in ACTIVE_SUBSCRIPTION_STATUSES


def has_feature(user: dict, feature_name: str) -> bool:
    plan = str(user.get("plan") or "starter").strip().lower()
    features = get_plan_features(plan)

    # starter features are allowed as defined
    if plan == "starter":
        return bool(features.get(feature_name, False))

    # paid plans must also be active
    if not is_paid_active(user):
        return False

    return bool(features.get(feature_name, False))


def require_feature(user: dict, feature_name: str, upgrade_plan: str | None = None) -> None:
    if has_feature(user, feature_name):
        return

    message = "Feature locked. Upgrade required."
    if upgrade_plan:
        message = f"This feature requires {upgrade_plan}."
    raise HTTPException(status_code=403, detail=message)


def require_event_limit(user: dict, current_count: int) -> None:
    plan = str(user.get("plan") or "starter").strip().lower()
    features = get_plan_features(plan)
    max_events = int(features.get("max_events", 1))

    # enterprise-style limits should require active status if not starter
    if plan != "starter" and not is_paid_active(user):
        max_events = 1

    if current_count >= max_events:
        raise HTTPException(
            status_code=403,
            detail=f"Event limit reached for plan '{plan}'. Upgrade required.",
        )