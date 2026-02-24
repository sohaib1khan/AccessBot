# backend/app/routers/suggestions.py
"""
Smart Suggestions — proactive AI tips shown after each assistant reply.

Architecture:
- POST /chat/suggestions  →  reads recent messages + check-in context + hour-of-day,
                              asks the LLM for 1-3 JSON suggestion objects,
                              returns them (or [] on any error).
- In-memory per-user cooldown: won't re-call the LLM if the same user got
  suggestions less than COOLDOWN_MINUTES ago.  Returns cached list instead.
- On failure the function ALWAYS returns [], so the main chat flow is never broken.
"""

import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user
from app.models.user import User
from app.models.conversation import Conversation, Message
from app.services.ai.router import ai_router         # shared LLM caller
from app.plugins.manager import plugin_manager

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Cooldown cache ────────────────────────────────────────────────────────────
# { user_id: {"last_at": datetime, "cached": list[dict]} }
_suggestion_cache: dict[int, dict] = {}
COOLDOWN_MINUTES = 10   # don't re-query LLM more often than this per user

# ── Request / Response models ──────────────────────────────────────────────────

class SuggestionRequest(BaseModel):
    conversation_id: int

class Suggestion(BaseModel):
    text: str        # label shown on the chip, e.g. "Log your energy level"
    action: str      # "message" | "checkin" | "resources" | "breathing"
    payload: str = ""  # for action=="message": pre-fill text; otherwise ignored

class SuggestionsResponse(BaseModel):
    suggestions: list[Suggestion]


# ── Helper prompt ──────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """\
You are AccessBot, a compassionate AI companion for people with disabilities.
Your job right now is NOT to chat — it is to produce 1 to 3 SHORT proactive \
suggestion chips that the user might find helpful based on the context below.

Rules:
1. Return ONLY a valid JSON array (no markdown, no prose outside the array).
2. Each element must have exactly these keys:
   - "text"    : short label shown on the chip (max 60 chars), e.g. "Log your energy level"
   - "action"  : one of: "message", "checkin", "resources", "breathing"
   - "payload" : if action=="message", the pre-filled message text; otherwise ""
3. Only suggest what is genuinely relevant.  If nothing fits, return [].
4. "breathing" is a 4-7-8 breathing exercise — only suggest it when the user
   seems stressed, anxious, or overwhelmed in recent messages.
5. "checkin" navigates to the daily check-in page — only suggest if the user
   has NOT checked in today.
6. "resources" navigates to the resources library.
7. "message" pre-fills the chat input — use it for actionable follow-up tasks.
8. Never repeat a suggestion that was offered very recently.

Examples of good suggestions:
[
  {"text": "Log your energy level", "action": "checkin", "payload": ""},
  {"text": "Browse coping resources", "action": "resources", "payload": ""},
  {"text": "Try a 4-7-8 breathing exercise", "action": "breathing", "payload": ""},
  {"text": "Review your resume together", "action": "message", "payload": "Can you help me review my resume?"}
]
"""


def _build_user_prompt(
    messages: list[dict],
    plugin_context: str,
    hour: int,
    checked_in_today: bool,
) -> str:
    hour_label = "morning" if hour < 12 else ("afternoon" if hour < 17 else "evening")

    lines = [
        f"Current time: {hour_label} (hour={hour})",
        f"User has checked in today: {checked_in_today}",
    ]
    if plugin_context:
        lines.append(f"\nContext from plugins:\n{plugin_context}")

    lines.append("\nLast messages in the conversation (newest last):")
    for m in messages:
        role = m["role"].upper()
        # strip any image JSON to just the text part
        content = m["content"]
        try:
            parsed = json.loads(content)
            if isinstance(parsed, dict) and "text" in parsed:
                content = parsed["text"] or ""
        except Exception:
            pass
        lines.append(f"  [{role}]: {content[:300]}")

    lines.append(
        "\nNow produce the JSON array of suggestion chips. "
        "Return [] if nothing is relevant."
    )
    return "\n".join(lines)


# ── Main endpoint ──────────────────────────────────────────────────────────────

@router.post("", response_model=SuggestionsResponse)
async def get_suggestions(
    req: SuggestionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Return 0-3 proactive suggestion chips for the current user.
    Always returns a valid response; falls back to [] on any error.
    """
    uid = current_user.id

    # ── Cooldown check ────────────────────────────────────────────────────────
    now = datetime.now(timezone.utc)
    cached = _suggestion_cache.get(uid)
    if cached:
        age = (now - cached["last_at"]).total_seconds() / 60
        if age < COOLDOWN_MINUTES:
            return {"suggestions": cached["cached"]}

    try:
        # ── Load recent conversation messages ─────────────────────────────────
        conv = db.query(Conversation).filter(
            Conversation.id == req.conversation_id,
            Conversation.user_id == uid,
        ).first()
        if not conv:
            return {"suggestions": []}

        recent_msgs = (
            db.query(Message)
            .filter(Message.conversation_id == conv.id)
            .order_by(Message.created_at.desc())
            .limit(10)
            .all()
        )
        # reverse to chronological order
        recent_msgs = list(reversed(recent_msgs))
        msg_dicts = [{"role": m.role, "content": m.content} for m in recent_msgs]

        # ── Plugin context (mood, check-in) ───────────────────────────────────
        plugin_context = await plugin_manager.collect_ai_context(uid, db)
        checked_in_today = _check_if_checked_in_today(uid, db)

        # ── Build LLM messages ────────────────────────────────────────────────
        hour = datetime.now().hour
        user_prompt = _build_user_prompt(msg_dicts, plugin_context, hour, checked_in_today)
        llm_messages = [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ]

        # ── Call LLM (reuse shared ai_router) ────────────────────────────────
        raw = await ai_router.chat(uid, llm_messages, db)

        # ── Parse JSON from LLM reply ─────────────────────────────────────────
        suggestions = _parse_suggestions(raw)

    except Exception as exc:
        logger.warning("Smart suggestions failed for user %s: %s", uid, exc)
        suggestions = []

    # Cache and return
    _suggestion_cache[uid] = {"last_at": now, "cached": suggestions}
    return {"suggestions": suggestions}


# ── Helpers ────────────────────────────────────────────────────────────────────

def _check_if_checked_in_today(user_id: int, db: Session) -> bool:
    """Returns True if the user already has a check-in entry for today."""
    from app.models.plugin import UserAnalytics
    from datetime import date
    today_str = str(date.today())
    row = db.query(UserAnalytics).filter(
        UserAnalytics.user_id == user_id,
        UserAnalytics.plugin_name == "daily_checkin",
        UserAnalytics.event_type == "checkin",
        UserAnalytics.event_data.contains(today_str),
    ).first()
    return row is not None


VALID_ACTIONS = {"message", "checkin", "resources", "breathing"}

def _parse_suggestions(raw: str) -> list[dict]:
    """
    Extract the JSON array from the LLM reply.
    Returns [] on any parsing or validation failure.
    """
    if not raw:
        return []
    # The LLM sometimes wraps JSON in ```json ... ``` fences
    text = raw.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        # strip first and last fence lines
        inner = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(inner)

    # Find the first [ ... ] block
    start = text.find("[")
    end   = text.rfind("]")
    if start == -1 or end == -1:
        return []

    try:
        parsed = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return []

    results = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        text_val   = str(item.get("text", "")).strip()[:80]
        action_val = str(item.get("action", "")).strip().lower()
        payload_val = str(item.get("payload", "")).strip()[:300]
        if text_val and action_val in VALID_ACTIONS:
            results.append({"text": text_val, "action": action_val, "payload": payload_val})
        if len(results) >= 3:
            break

    return results
