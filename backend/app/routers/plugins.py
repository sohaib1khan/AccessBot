# backend/app/routers/plugins.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from pydantic import BaseModel
from typing import List
from uuid import uuid4
from app.core.database import get_db
from app.core.auth import get_current_user
from app.models.user import User
from app.models.plugin import UserPlugin
from app.plugins.manager import plugin_manager
from app.plugins.daily_checkin.plugin import daily_checkin_plugin
from app.plugins.mood_tracker.plugin import mood_tracker_plugin
from app.plugins.recharge.plugin import recharge_plugin

router = APIRouter()


# ── Request / Response models ────────────────────────────────────────────────

class PluginInfo(BaseModel):
    name: str
    display_name: str
    description: str
    enabled: bool


class CheckinRequest(BaseModel):
    mood: str        # 'great' | 'good' | 'okay' | 'tired' | 'struggling'
    note: str | None = None


class CheckinStatusResponse(BaseModel):
    checked_in_today: bool
    todays_id: int | None = None
    todays_mood: str | None = None
    todays_label: str | None = None
    todays_note: str | None = None


class CheckinUpdateRequest(BaseModel):
    mood: str
    note: str | None = None


class AISuggestRequest(BaseModel):
    mood: str
    context: str | None = None


class MoodEntry(BaseModel):
    id: int
    mood: str
    note: str
    emoji: str
    date: str
    recorded_at: str


class MoodHistoryResponse(BaseModel):
    entries: List[MoodEntry]
    summary: dict


class RechargeFeedResponse(BaseModel):
    articles: list[dict]
    videos: list[dict]
    audio: list[dict]
    quote: dict
    updated_at: str


class RechargeItemInput(BaseModel):
    type: str
    title: str
    url: str
    source: str | None = None
    summary: str | None = None


class RechargeItemResponse(BaseModel):
    id: str
    type: str
    title: str
    url: str
    source: str
    summary: str


class RechargeCustomItemsResponse(BaseModel):
    items: list[RechargeItemResponse]


VALID_RECHARGE_TYPES = {"article", "video", "audio"}


def _recharge_row(user_id: int, db: Session) -> UserPlugin:
    row = db.query(UserPlugin).filter(
        UserPlugin.user_id == user_id,
        UserPlugin.plugin_name == "recharge"
    ).first()
    if not row:
        row = UserPlugin(user_id=user_id, plugin_name="recharge", enabled=True, settings={})
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def _custom_items(row: UserPlugin) -> list[dict]:
    settings = row.settings if isinstance(row.settings, dict) else {}
    items = settings.get("custom_items", [])
    return items if isinstance(items, list) else []


def _save_custom_items(row: UserPlugin, items: list[dict], db: Session):
    settings = row.settings if isinstance(row.settings, dict) else {}
    settings["custom_items"] = items
    row.settings = settings
    flag_modified(row, "settings")
    db.add(row)
    db.commit()
    db.refresh(row)


def _validate_recharge_payload(data: RechargeItemInput) -> dict:
    item_type = (data.type or "").strip().lower()
    if item_type not in VALID_RECHARGE_TYPES:
        raise HTTPException(status_code=400, detail="type must be article, video, or audio")

    title = (data.title or "").strip()
    url = (data.url or "").strip()
    source = (data.source or "Custom").strip() or "Custom"
    summary = (data.summary or "").strip()

    if not title:
        raise HTTPException(status_code=400, detail="title is required")
    if not url:
        raise HTTPException(status_code=400, detail="url is required")
    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(status_code=400, detail="url must start with http:// or https://")

    return {
        "type": item_type,
        "title": title[:180],
        "url": url[:500],
        "source": source[:80],
        "summary": summary[:500],
    }


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("", response_model=List[PluginInfo])
async def list_plugins(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all plugins with their enabled status for the current user."""
    return [
        {
            "name": p.name,
            "display_name": p.display_name,
            "description": p.description,
            "enabled": plugin_manager.is_enabled(p.name, current_user.id, db),
        }
        for p in plugin_manager.all_plugins()
    ]


@router.post("/{plugin_name}/toggle")
async def toggle_plugin(
    plugin_name: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Toggle a plugin on or off for the current user."""
    plugin = plugin_manager.get(plugin_name)
    if not plugin:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plugin not found")

    currently_enabled = plugin_manager.is_enabled(plugin_name, current_user.id, db)
    new_state = not currently_enabled
    plugin_manager.set_enabled(plugin_name, current_user.id, new_state, db)

    return {"plugin": plugin_name, "enabled": new_state}


# ── Daily Check-in endpoints ─────────────────────────────────────────────────

@router.get("/checkin/status", response_model=CheckinStatusResponse)
async def checkin_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Check if the current user has done their daily check-in."""
    from app.plugins.daily_checkin.plugin import MOOD_LABELS
    entry = daily_checkin_plugin._todays_checkin(current_user.id, db)
    if entry:
        mood = entry.metric_value.get("mood", "")
        return {
            "checked_in_today": True,
            "todays_id": entry.id,
            "todays_mood": mood,
            "todays_label": MOOD_LABELS.get(mood, mood),
            "todays_note": entry.metric_value.get("note") or None,
        }
    return {"checked_in_today": False}


@router.post("/checkin")
async def submit_checkin(
    data: CheckinRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Submit or update today's daily check-in (upsert — no duplicates)."""
    if not plugin_manager.is_enabled("daily_checkin", current_user.id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Daily check-in plugin is disabled")

    MOOD_LABELS_LOCAL = {
        "great": "😊 Great", "good": "🙂 Good", "okay": "😐 Okay",
        "tired": "😴 Tired", "struggling": "😔 Struggling",
    }
    MOOD_EMOJI_LOCAL = {
        "great": "😊", "good": "🙂", "okay": "😐", "tired": "😴", "struggling": "😔",
    }
    if data.mood not in MOOD_LABELS_LOCAL:
        raise HTTPException(status_code=400, detail=f"Invalid mood '{data.mood}'.")

    # Upsert: update today's entry if it already exists
    existing = daily_checkin_plugin._todays_checkin(current_user.id, db)
    if existing:
        existing.metric_value = {"mood": data.mood, "note": data.note or ""}
        flag_modified(existing, "metric_value")
        db.commit()
        db.refresh(existing)
        return {
            "id": existing.id,
            "mood": data.mood,
            "label": MOOD_LABELS_LOCAL[data.mood],
            "emoji": MOOD_EMOJI_LOCAL.get(data.mood, ""),
            "note": data.note or "",
            "recorded_at": existing.recorded_at.isoformat(),
        }

    try:
        result = daily_checkin_plugin.submit_checkin(current_user.id, data.mood, data.note, db)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return result


@router.get("/checkin/history")
async def checkin_history(
    days: int = 365,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Return all check-ins for the current user, newest first."""
    from datetime import date, datetime, timedelta, timezone
    from app.models.plugin import UserAnalytics
    MOOD_LABELS_LOCAL = {
        "great": "😊 Great", "good": "🙂 Good", "okay": "😐 Okay",
        "tired": "😴 Tired", "struggling": "😔 Struggling",
    }
    MOOD_EMOJI_LOCAL = {
        "great": "😊", "good": "🙂", "okay": "😐", "tired": "😴", "struggling": "😔",
    }
    since = datetime.combine(
        date.today() - timedelta(days=max(days, 1)),
        datetime.min.time()
    ).replace(tzinfo=timezone.utc)
    entries = (
        db.query(UserAnalytics)
        .filter(
            UserAnalytics.user_id == current_user.id,
            UserAnalytics.metric_type == "checkin",
            UserAnalytics.recorded_at >= since,
        )
        .order_by(UserAnalytics.recorded_at.desc())
        .all()
    )
    result = []
    for e in entries:
        mood = e.metric_value.get("mood", "okay")
        result.append({
            "id": e.id,
            "mood": mood,
            "label": MOOD_LABELS_LOCAL.get(mood, mood),
            "emoji": MOOD_EMOJI_LOCAL.get(mood, ""),
            "note": e.metric_value.get("note", ""),
            "date": e.recorded_at.strftime("%Y-%m-%d"),
            "recorded_at": e.recorded_at.isoformat(),
        })
    return {"entries": result}


@router.post("/checkin/ai-suggest")
async def checkin_ai_suggest(
    data: AISuggestRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Ask the LLM for a suggested journal note based on the user's mood."""
    from app.services.ai.router import AIRouter
    MOOD_LABELS_LOCAL = {
        "great": "great", "good": "good", "okay": "okay",
        "tired": "tired", "struggling": "struggling",
    }
    router_ai = AIRouter()
    settings = await router_ai.get_user_settings(current_user.id, db)
    if not settings.get("api_endpoint"):
        raise HTTPException(status_code=400, detail="LLM not configured. Save your settings first.")

    mood_desc = MOOD_LABELS_LOCAL.get(data.mood, data.mood)
    prompt = f"The user is doing their daily wellness check-in and is feeling '{mood_desc}' today."
    if data.context:
        prompt += f" They mentioned: {data.context}."
    prompt += " Please write a short, warm, empathetic 1-2 sentence journal note in first person that they could save as their check-in note. Be concise and supportive. Reply with only the note text, no quotes or preamble."

    try:
        suggestion = await router_ai.provider.chat(
            [{"role": "user", "content": prompt}],
            settings
        )
        return {"suggestion": suggestion.strip()}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.patch("/checkin/{entry_id}")
async def update_checkin(
    entry_id: int,
    data: CheckinUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update mood and/or note on an existing check-in."""
    from app.models.plugin import UserAnalytics
    MOOD_LABELS_LOCAL = {
        "great": "😊 Great", "good": "🙂 Good", "okay": "😐 Okay",
        "tired": "😴 Tired", "struggling": "😔 Struggling",
    }
    MOOD_EMOJI_LOCAL = {
        "great": "😊", "good": "🙂", "okay": "😐", "tired": "😴", "struggling": "😔",
    }
    entry = db.query(UserAnalytics).filter(
        UserAnalytics.id == entry_id,
        UserAnalytics.user_id == current_user.id,
        UserAnalytics.metric_type == "checkin",
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Check-in not found.")
    if data.mood not in MOOD_LABELS_LOCAL:
        raise HTTPException(status_code=400, detail=f"Invalid mood '{data.mood}'.")
    entry.metric_value = {"mood": data.mood, "note": data.note or ""}
    flag_modified(entry, "metric_value")
    db.commit()
    db.refresh(entry)
    return {
        "id": entry.id,
        "mood": data.mood,
        "label": MOOD_LABELS_LOCAL[data.mood],
        "emoji": MOOD_EMOJI_LOCAL.get(data.mood, ""),
        "note": data.note or "",
        "recorded_at": entry.recorded_at.isoformat(),
    }


@router.delete("/checkin/{entry_id}")
async def delete_checkin(
    entry_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a check-in entry."""
    from app.models.plugin import UserAnalytics
    entry = db.query(UserAnalytics).filter(
        UserAnalytics.id == entry_id,
        UserAnalytics.user_id == current_user.id,
        UserAnalytics.metric_type == "checkin",
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Check-in not found.")
    db.delete(entry)
    db.commit()
    return {"message": "Deleted."}


# ── Mood history endpoints ────────────────────────────────────────────────────

@router.get("/mood/history", response_model=MoodHistoryResponse)
async def mood_history(
    days: int = 30,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get mood history for the current user (defaults to last 30 days)."""
    if not plugin_manager.is_enabled("mood_tracker", current_user.id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Mood tracker plugin is disabled")

    entries = mood_tracker_plugin.get_history(current_user.id, db, days=min(days, 365))
    summary = mood_tracker_plugin.mood_summary(current_user.id, db)

    return {"entries": entries, "summary": summary}


@router.get("/recharge/feed", response_model=RechargeFeedResponse)
async def recharge_feed(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get curated motivation/recharge content feed."""
    from datetime import datetime, timezone

    if not plugin_manager.is_enabled("recharge", current_user.id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Recharge plugin is disabled")

    quote = await recharge_plugin.quote()
    return {
        "articles": recharge_plugin.articles(),
        "videos": recharge_plugin.videos(),
        "audio": recharge_plugin.audio(),
        "quote": quote,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/recharge/custom-items", response_model=RechargeCustomItemsResponse)
async def recharge_custom_items(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get user-managed recharge items."""
    if not plugin_manager.is_enabled("recharge", current_user.id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Recharge plugin is disabled")

    row = _recharge_row(current_user.id, db)
    return {"items": _custom_items(row)}


@router.post("/recharge/custom-items", response_model=RechargeItemResponse)
async def recharge_add_custom_item(
    data: RechargeItemInput,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Add a user-managed recharge item."""
    if not plugin_manager.is_enabled("recharge", current_user.id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Recharge plugin is disabled")

    clean = _validate_recharge_payload(data)
    row = _recharge_row(current_user.id, db)
    items = _custom_items(row)

    item = {
        "id": uuid4().hex[:12],
        **clean,
    }
    items.insert(0, item)
    _save_custom_items(row, items, db)
    return item


@router.patch("/recharge/custom-items/{item_id}", response_model=RechargeItemResponse)
async def recharge_edit_custom_item(
    item_id: str,
    data: RechargeItemInput,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Edit a user-managed recharge item."""
    if not plugin_manager.is_enabled("recharge", current_user.id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Recharge plugin is disabled")

    clean = _validate_recharge_payload(data)
    row = _recharge_row(current_user.id, db)
    items = _custom_items(row)

    for idx, item in enumerate(items):
        if item.get("id") == item_id:
            updated = {"id": item_id, **clean}
            items[idx] = updated
            _save_custom_items(row, items, db)
            return updated

    raise HTTPException(status_code=404, detail="Custom item not found")


@router.delete("/recharge/custom-items/{item_id}")
async def recharge_delete_custom_item(
    item_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a user-managed recharge item."""
    if not plugin_manager.is_enabled("recharge", current_user.id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Recharge plugin is disabled")

    row = _recharge_row(current_user.id, db)
    items = _custom_items(row)
    remaining = [x for x in items if x.get("id") != item_id]
    if len(remaining) == len(items):
        raise HTTPException(status_code=404, detail="Custom item not found")

    _save_custom_items(row, remaining, db)
    return {"deleted": item_id}
