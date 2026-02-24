# backend/app/plugins/mood_tracker/plugin.py
from datetime import date, timedelta, timezone, datetime
from sqlalchemy.orm import Session
from app.plugins.base_plugin import BasePlugin
from app.models.plugin import UserAnalytics


MOOD_EMOJI = {
    "great":      "😊",
    "good":       "🙂",
    "okay":       "😐",
    "tired":      "😴",
    "struggling": "😔",
}


class MoodTrackerPlugin(BasePlugin):
    name = "mood_tracker"
    display_name = "Mood Tracker"
    description = (
        "Keeps a 30-day history of your daily moods. "
        "Lets the AI notice patterns and offer better support."
    )

    async def get_context(self, user_id: int, db: Session) -> str | None:
        """Give the AI a brief summary of the user's recent moods (last 5 entries)."""
        recent = self.get_history(user_id, db, days=7)
        if not recent:
            return None

        lines = []
        for entry in recent[-5:]:     # most recent 5
            emoji = MOOD_EMOJI.get(entry["mood"], "")
            lines.append(f"  • {entry['date']}: {emoji} {entry['mood']}")

        return "[Mood History - last 7 days]\n" + "\n".join(lines)

    # ── Helpers (called by plugin router) ────────────────────────────────────

    def get_history(self, user_id: int, db: Session, days: int = 30) -> list[dict]:
        """Return a list of mood entries from the last `days` days."""
        since = datetime.combine(
            date.today() - timedelta(days=days),
            datetime.min.time()
        ).replace(tzinfo=timezone.utc)

        rows = (
            db.query(UserAnalytics)
            .filter(
                UserAnalytics.user_id == user_id,
                UserAnalytics.metric_type == "checkin",
                UserAnalytics.recorded_at >= since,
            )
            .order_by(UserAnalytics.recorded_at)
            .all()
        )

        return [
            {
                "id": row.id,
                "mood": row.metric_value.get("mood", ""),
                "note": row.metric_value.get("note", ""),
                "emoji": MOOD_EMOJI.get(row.metric_value.get("mood", ""), ""),
                "date": row.recorded_at.strftime("%Y-%m-%d"),
                "recorded_at": row.recorded_at.isoformat(),
            }
            for row in rows
        ]

    def mood_summary(self, user_id: int, db: Session) -> dict:
        """Count mood occurrences over the last 30 days."""
        history = self.get_history(user_id, db, days=30)
        counts: dict[str, int] = {}
        for entry in history:
            mood = entry["mood"]
            counts[mood] = counts.get(mood, 0) + 1
        return {"total": len(history), "counts": counts}


# Module-level instance
mood_tracker_plugin = MoodTrackerPlugin()
