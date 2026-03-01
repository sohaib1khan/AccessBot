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
from app.models.plugin import UserPlugin, UserAnalytics
from app.plugins.manager import plugin_manager
from app.plugins.daily_checkin.plugin import daily_checkin_plugin
from app.plugins.mood_tracker.plugin import mood_tracker_plugin
from app.plugins.recharge.plugin import recharge_plugin
from datetime import datetime, timezone, date, timedelta

router = APIRouter()


# ── Request / Response models ────────────────────────────────────────────────

class PluginInfo(BaseModel):
    name: str
    display_name: str
    description: str
    enabled: bool


class PluginToggleRequest(BaseModel):
    enabled: bool | None = None


class CheckinRequest(BaseModel):
    mood: str        # 'great' | 'good' | 'okay' | 'tired' | 'struggling'
    note: str | None = None
    checkin_date: str | None = None  # YYYY-MM-DD (optional backfill date)


class CheckinStatusResponse(BaseModel):
    checked_in_today: bool
    todays_id: int | None = None
    todays_mood: str | None = None
    todays_label: str | None = None
    todays_note: str | None = None
    last_checkin_date: str | None = None   # ISO date of the most recent past entry
    days_since_last: int | None = None     # None = never checked in before


class CheckinUpdateRequest(BaseModel):
    mood: str
    note: str | None = None
    checkin_date: str | None = None  # YYYY-MM-DD optional when moving an entry


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


class UrgentChatMessage(BaseModel):
    role: str
    content: str


class UrgentChatRequest(BaseModel):
    message: str
    history: list[UrgentChatMessage] = []


class KanbanCardCreateRequest(BaseModel):
    title: str
    note: str | None = None
    column: str = "pending"


class KanbanCardUpdateRequest(BaseModel):
    title: str | None = None
    note: str | None = None
    column: str | None = None


class TaskBreakdownRequest(BaseModel):
    task: str


VALID_RECHARGE_TYPES = {"article", "video", "audio"}
VALID_TASK_BOARD_COLUMNS = {"backlog", "pending", "inprogress", "completed"}


def _normalize_task_board_column(column: str | None, fallback: str = "pending") -> str:
    raw = (column or "").strip().lower()
    if raw == "in_progress":
        raw = "inprogress"

    legacy_map = {
        "now": "inprogress",
        "next": "pending",
        "done": "completed",
    }
    mapped = legacy_map.get(raw, raw)
    return mapped if mapped in VALID_TASK_BOARD_COLUMNS else fallback


def _kanban_row(user_id: int, db: Session) -> UserPlugin:
    row = db.query(UserPlugin).filter(
        UserPlugin.user_id == user_id,
        UserPlugin.plugin_name == "kanban_board"
    ).first()
    if not row:
        row = UserPlugin(user_id=user_id, plugin_name="kanban_board", enabled=True, settings={})
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def _kanban_settings(row: UserPlugin) -> dict:
    return row.settings if isinstance(row.settings, dict) else {}


def _kanban_save(row: UserPlugin, settings: dict, db: Session):
    row.settings = settings
    flag_modified(row, "settings")
    db.add(row)
    db.commit()
    db.refresh(row)


def _task_row(user_id: int, db: Session) -> UserPlugin:
    row = db.query(UserPlugin).filter(
        UserPlugin.user_id == user_id,
        UserPlugin.plugin_name == "task_breakdown"
    ).first()
    if not row:
        row = UserPlugin(user_id=user_id, plugin_name="task_breakdown", enabled=True, settings={})
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def _task_settings(row: UserPlugin) -> dict:
    return row.settings if isinstance(row.settings, dict) else {}


def _task_save(row: UserPlugin, settings: dict, db: Session):
    row.settings = settings
    flag_modified(row, "settings")
    db.add(row)
    db.commit()
    db.refresh(row)


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


def _parse_checkin_date(checkin_date_str: str | None) -> date:
    if not checkin_date_str:
        return date.today()

    try:
        target_date = datetime.strptime(checkin_date_str, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="checkin_date must be YYYY-MM-DD")

    if target_date > date.today():
        raise HTTPException(status_code=400, detail="checkin_date cannot be in the future")

    return target_date


def _checkin_for_date(user_id: int, target_date: date, db: Session) -> UserAnalytics | None:
    start = datetime.combine(target_date, datetime.min.time()).replace(tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    return (
        db.query(UserAnalytics)
        .filter(
            UserAnalytics.user_id == user_id,
            UserAnalytics.metric_type == "checkin",
            UserAnalytics.recorded_at >= start,
            UserAnalytics.recorded_at < end,
        )
        .order_by(UserAnalytics.recorded_at.desc())
        .first()
    )


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
    data: PluginToggleRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Toggle a plugin on or off for the current user."""
    plugin = plugin_manager.get(plugin_name)
    if not plugin:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plugin not found")

    currently_enabled = plugin_manager.is_enabled(plugin_name, current_user.id, db)
    new_state = data.enabled if (data is not None and data.enabled is not None) else (not currently_enabled)
    plugin_manager.set_enabled(plugin_name, current_user.id, new_state, db)

    return {"plugin": plugin_name, "enabled": new_state}


# ── Daily Check-in endpoints ─────────────────────────────────────────────────

@router.get("/checkin/status", response_model=CheckinStatusResponse)
async def checkin_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Check if the current user has done their daily check-in."""
    if not plugin_manager.is_enabled("daily_checkin", current_user.id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Enable plugin please: Daily Check-in")

    from app.plugins.daily_checkin.plugin import MOOD_LABELS
    from datetime import date, timezone, datetime

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

    # Not checked in today — find most recent past entry for the reminder
    today_start = datetime.combine(date.today(), datetime.min.time()).replace(tzinfo=timezone.utc)
    last_entry = (
        db.query(UserAnalytics)
        .filter(
            UserAnalytics.user_id == current_user.id,
            UserAnalytics.metric_type == "checkin",
            UserAnalytics.recorded_at < today_start,
        )
        .order_by(UserAnalytics.recorded_at.desc())
        .first()
    )

    if last_entry:
        last_date  = last_entry.recorded_at.date()
        days_since = (date.today() - last_date).days
        return {
            "checked_in_today": False,
            "last_checkin_date": last_date.isoformat(),
            "days_since_last": days_since,
        }

    return {"checked_in_today": False, "last_checkin_date": None, "days_since_last": None}


@router.post("/checkin")
async def submit_checkin(
    data: CheckinRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Submit or update a daily check-in for today or a past date (upsert per date)."""
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

    target_date = _parse_checkin_date(data.checkin_date)

    # Upsert: update check-in for target date if it already exists
    existing = _checkin_for_date(current_user.id, target_date, db)
    if existing:
        existing.metric_value = {"mood": data.mood, "note": data.note or "", "checkin_date": target_date.isoformat()}
        flag_modified(existing, "metric_value")
        db.commit()
        db.refresh(existing)
        return {
            "id": existing.id,
            "mood": data.mood,
            "label": MOOD_LABELS_LOCAL[data.mood],
            "emoji": MOOD_EMOJI_LOCAL.get(data.mood, ""),
            "note": data.note or "",
            "date": target_date.isoformat(),
            "recorded_at": existing.recorded_at.isoformat(),
        }

    entry_time = datetime.combine(target_date, datetime.min.time()).replace(tzinfo=timezone.utc) + timedelta(hours=12)
    entry = UserAnalytics(
        user_id=current_user.id,
        metric_type="checkin",
        metric_value={"mood": data.mood, "note": data.note or "", "checkin_date": target_date.isoformat()},
        recorded_at=entry_time,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)

    return {
        "id": entry.id,
        "mood": data.mood,
        "label": MOOD_LABELS_LOCAL[data.mood],
        "emoji": MOOD_EMOJI_LOCAL.get(data.mood, ""),
        "note": data.note or "",
        "date": target_date.isoformat(),
        "recorded_at": entry.recorded_at.isoformat(),
    }


@router.get("/checkin/history")
async def checkin_history(
    days: int = 365,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Return all check-ins for the current user, newest first."""
    if not plugin_manager.is_enabled("daily_checkin", current_user.id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Enable plugin please: Daily Check-in")

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
        checkin_date = e.metric_value.get("checkin_date") if isinstance(e.metric_value, dict) else None
        result.append({
            "id": e.id,
            "mood": mood,
            "label": MOOD_LABELS_LOCAL.get(mood, mood),
            "emoji": MOOD_EMOJI_LOCAL.get(mood, ""),
            "note": e.metric_value.get("note", ""),
            "date": checkin_date or e.recorded_at.strftime("%Y-%m-%d"),
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
    if not plugin_manager.is_enabled("daily_checkin", current_user.id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Enable plugin please: Daily Check-in")

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
    if not plugin_manager.is_enabled("daily_checkin", current_user.id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Enable plugin please: Daily Check-in")

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
    target_date = _parse_checkin_date(data.checkin_date) if data.checkin_date else None
    if target_date:
        existing_for_target = _checkin_for_date(current_user.id, target_date, db)
        if existing_for_target and existing_for_target.id != entry.id:
            existing_for_target.metric_value = {"mood": data.mood, "note": data.note or "", "checkin_date": target_date.isoformat()}
            flag_modified(existing_for_target, "metric_value")
            db.delete(entry)
            db.commit()
            db.refresh(existing_for_target)
            return {
                "id": existing_for_target.id,
                "mood": data.mood,
                "label": MOOD_LABELS_LOCAL[data.mood],
                "emoji": MOOD_EMOJI_LOCAL.get(data.mood, ""),
                "note": data.note or "",
                "date": target_date.isoformat(),
                "recorded_at": existing_for_target.recorded_at.isoformat(),
            }

        entry.recorded_at = datetime.combine(target_date, datetime.min.time()).replace(tzinfo=timezone.utc) + timedelta(hours=12)

    entry.metric_value = {"mood": data.mood, "note": data.note or "", **({"checkin_date": target_date.isoformat()} if target_date else {})}
    flag_modified(entry, "metric_value")
    db.commit()
    db.refresh(entry)
    return {
        "id": entry.id,
        "mood": data.mood,
        "label": MOOD_LABELS_LOCAL[data.mood],
        "emoji": MOOD_EMOJI_LOCAL.get(data.mood, ""),
        "note": data.note or "",
        "date": (target_date.isoformat() if target_date else entry.recorded_at.strftime("%Y-%m-%d")),
        "recorded_at": entry.recorded_at.isoformat(),
    }


@router.delete("/checkin/{entry_id}")
async def delete_checkin(
    entry_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a check-in entry."""
    if not plugin_manager.is_enabled("daily_checkin", current_user.id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Enable plugin please: Daily Check-in")

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


@router.get("/recharge/quote")
async def recharge_quote(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get a fresh motivational quote."""
    from datetime import datetime, timezone

    if not plugin_manager.is_enabled("recharge", current_user.id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Recharge plugin is disabled")

    quote = await recharge_plugin.quote()
    return {"quote": quote, "updated_at": datetime.now(timezone.utc).isoformat()}


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


@router.post("/urgent/session")
async def urgent_session_chat(
    data: UrgentChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not plugin_manager.is_enabled("crisis_support", current_user.id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Enable plugin please: Urgent Support Chat")

    if not data.message or not data.message.strip():
        raise HTTPException(status_code=400, detail="message is required")

    from app.services.ai.router import ai_router

    history_msgs = [
        {"role": m.role, "content": m.content}
        for m in (data.history or [])
        if m.role in ("user", "assistant") and isinstance(m.content, str) and m.content.strip()
    ][-12:]

    system_prompt = (
        "You are AccessBot Urgent Support mode. Keep the user safe, calm, and supported. "
        "Use brief, compassionate language. Help break overwhelming problems into tiny next steps. "
        "Do NOT contact anyone or suggest contacting someone unless user explicitly asks. "
        "Avoid diagnosis. Focus on grounding, immediate stabilization, and practical actions in the next 10 minutes."
    )

    ai_messages = [{"role": "system", "content": system_prompt}] + history_msgs + [{"role": "user", "content": data.message.strip()}]
    reply = await ai_router.chat(current_user.id, ai_messages, db)
    return {"message": reply}


@router.get("/task-board/cards")
@router.get("/kanban/cards")
async def kanban_list_cards(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not plugin_manager.is_enabled("kanban_board", current_user.id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Enable plugin please: Task Board")

    row = _kanban_row(current_user.id, db)
    settings = _kanban_settings(row)
    cards = settings.get("cards", []) if isinstance(settings.get("cards", []), list) else []

    normalized = []
    for c in cards:
        col = _normalize_task_board_column(c.get("column"), "pending")
        normalized.append({
            "id": c.get("id"),
            "title": c.get("title", ""),
            "note": c.get("note") or "",
            "column": col,
            "created_at": c.get("created_at"),
            "updated_at": c.get("updated_at"),
        })
    return {"cards": normalized}


@router.post("/task-board/cards")
@router.post("/kanban/cards")
async def kanban_add_card(
    data: KanbanCardCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not plugin_manager.is_enabled("kanban_board", current_user.id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Enable plugin please: Task Board")

    title = (data.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required")

    column = _normalize_task_board_column(data.column, "pending")

    row = _kanban_row(current_user.id, db)
    settings = _kanban_settings(row)
    cards = settings.get("cards", []) if isinstance(settings.get("cards", []), list) else []
    now_iso = datetime.now(timezone.utc).isoformat()
    card = {
        "id": uuid4().hex[:12],
        "title": title[:160],
        "note": (data.note or "")[:1000],
        "column": column,
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    cards.insert(0, card)
    settings["cards"] = cards
    _kanban_save(row, settings, db)
    return card


@router.patch("/task-board/cards/{card_id}")
@router.patch("/kanban/cards/{card_id}")
async def kanban_update_card(
    card_id: str,
    data: KanbanCardUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not plugin_manager.is_enabled("kanban_board", current_user.id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Enable plugin please: Task Board")

    row = _kanban_row(current_user.id, db)
    settings = _kanban_settings(row)
    cards = settings.get("cards", []) if isinstance(settings.get("cards", []), list) else []

    for card in cards:
        if card.get("id") == card_id:
            if data.title is not None:
                title = data.title.strip()
                if not title:
                    raise HTTPException(status_code=400, detail="title cannot be empty")
                card["title"] = title[:160]
            if data.note is not None:
                card["note"] = data.note[:1000]
            if data.column is not None:
                column = _normalize_task_board_column(data.column, "")
                if column not in VALID_TASK_BOARD_COLUMNS:
                    raise HTTPException(status_code=400, detail="column must be one of: backlog, pending, inprogress, completed")
                card["column"] = column
            card["updated_at"] = datetime.now(timezone.utc).isoformat()
            settings["cards"] = cards
            _kanban_save(row, settings, db)
            return card

    raise HTTPException(status_code=404, detail="Card not found")


@router.delete("/task-board/cards/{card_id}")
@router.delete("/kanban/cards/{card_id}")
async def kanban_delete_card(
    card_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not plugin_manager.is_enabled("kanban_board", current_user.id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Enable plugin please: Task Board")

    row = _kanban_row(current_user.id, db)
    settings = _kanban_settings(row)
    cards = settings.get("cards", []) if isinstance(settings.get("cards", []), list) else []
    remaining = [c for c in cards if c.get("id") != card_id]
    if len(remaining) == len(cards):
        raise HTTPException(status_code=404, detail="Card not found")
    settings["cards"] = remaining
    _kanban_save(row, settings, db)
    return {"deleted": card_id}


@router.post("/task-breakdown/plan")
async def task_breakdown_plan(
    data: TaskBreakdownRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not plugin_manager.is_enabled("task_breakdown", current_user.id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Enable plugin please: Task Breakdown Coach")

    task = (data.task or "").strip()
    if not task:
        raise HTTPException(status_code=400, detail="task is required")

    from app.services.ai.router import ai_router
    prompt = (
        "Break this task into 5-8 tiny steps. For each step include: short title, 1 action sentence, and timer minutes. "
        "Keep tone gentle and practical. Return plain text only.\\n\\nTask: " + task
    )
    try:
        plan = await ai_router.chat(current_user.id, [{"role": "user", "content": prompt}], db)
        plan_text = plan
    except Exception:
        fallback = (
            "1) Clarify the smallest version of the task (5 min).\\n"
            "2) Gather what you need in one place (10 min).\\n"
            "3) Do the first concrete action only (15 min).\\n"
            "4) Take a short reset break (3 min).\\n"
            "5) Do the next small action (15 min).\\n"
            "6) Mark progress and choose next step for later (5 min)."
        )
        plan_text = fallback

    row = _task_row(current_user.id, db)
    settings = _task_settings(row)
    history = settings.get("history", []) if isinstance(settings.get("history", []), list) else []
    entry = {
        "id": uuid4().hex[:12],
        "task": task[:300],
        "plan": plan_text,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    history.insert(0, entry)
    settings["history"] = history[:20]
    _task_save(row, settings, db)
    return {"task": task, "plan": plan_text, "entry_id": entry["id"]}


@router.get("/task-breakdown/history")
async def task_breakdown_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not plugin_manager.is_enabled("task_breakdown", current_user.id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Enable plugin please: Task Breakdown Coach")

    row = _task_row(current_user.id, db)
    settings = _task_settings(row)
    history = settings.get("history", []) if isinstance(settings.get("history", []), list) else []
    return {"history": history[:20]}


@router.delete("/task-breakdown/history/{entry_id}")
async def task_breakdown_delete_history(
    entry_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not plugin_manager.is_enabled("task_breakdown", current_user.id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Enable plugin please: Task Breakdown Coach")

    row = _task_row(current_user.id, db)
    settings = _task_settings(row)
    history = settings.get("history", []) if isinstance(settings.get("history", []), list) else []
    next_history = [h for h in history if h.get("id") != entry_id]
    if len(next_history) == len(history):
        raise HTTPException(status_code=404, detail="History item not found")
    settings["history"] = next_history
    _task_save(row, settings, db)
    return {"deleted": entry_id}
