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
    is_paid_active = bool(user.get("is_paid_active"))

    if plan != "starter" and is_paid_active:
        return

    max_events = 1

    if current_count >= max_events:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "EVENT_LIMIT_REACHED",
                "plan": plan,
                "max_events": max_events,
                "message": "Your Starter plan includes 1 live event at a time.",
            },
        )