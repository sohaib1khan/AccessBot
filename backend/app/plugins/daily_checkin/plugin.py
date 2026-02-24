# backend/app/plugins/daily_checkin/plugin.py
from datetime import date, timezone, datetime
from sqlalchemy.orm import Session
from app.plugins.base_plugin import BasePlugin
from app.models.plugin import UserAnalytics


MOOD_LABELS = {
    "great":      "😊 Great",
    "good":       "🙂 Good",
    "okay":       "😐 Okay",
    "tired":      "😴 Tired",
    "struggling": "😔 Struggling",
}


class DailyCheckinPlugin(BasePlugin):
    name = "daily_checkin"
    display_name = "Daily Check-in"
    description = (
        "Asks how you're doing once a day and records your response. "
        "Helps the AI understand your current state."
    )

    async def get_context(self, user_id: int, db: Session) -> str | None:
        """
        If the user already checked in today, tell the AI what they said.
        If not, the AI doesn't need to know — the frontend will ask.
        """
        entry = self._todays_checkin(user_id, db)
        if entry:
            mood = entry.metric_value.get("mood", "")
            note = entry.metric_value.get("note", "")
            label = MOOD_LABELS.get(mood, mood)
            ctx = f"[Daily Check-in] The user checked in today and said they feel: {label}."
            if note:
                ctx += f' They added: "{note}"'
            return ctx
        return None

    # ── Helpers (called directly by the plugin router) ───────────────────────

    def has_checked_in_today(self, user_id: int, db: Session) -> bool:
        return self._todays_checkin(user_id, db) is not None

    def submit_checkin(self, user_id: int, mood: str, note: str | None, db: Session) -> dict:
        if mood not in MOOD_LABELS:
            raise ValueError(f"Invalid mood '{mood}'. Valid: {list(MOOD_LABELS)}")

        entry = UserAnalytics(
            user_id=user_id,
            metric_type="checkin",
            metric_value={"mood": mood, "note": note or ""}
        )
        db.add(entry)
        db.commit()
        db.refresh(entry)

        return {
            "mood": mood,
            "label": MOOD_LABELS[mood],
            "note": note or "",
            "recorded_at": entry.recorded_at.isoformat()
        }

    def _todays_checkin(self, user_id: int, db: Session) -> UserAnalytics | None:
        today_start = datetime.combine(date.today(), datetime.min.time()).replace(tzinfo=timezone.utc)
        return (
            db.query(UserAnalytics)
            .filter(
                UserAnalytics.user_id == user_id,
                UserAnalytics.metric_type == "checkin",
                UserAnalytics.recorded_at >= today_start,
            )
            .first()
        )


# Module-level instance
daily_checkin_plugin = DailyCheckinPlugin()
