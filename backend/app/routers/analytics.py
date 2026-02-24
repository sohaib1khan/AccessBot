# backend/app/routers/analytics.py
"""
Analytics & Insights API
Provides mood trends, streaks, and wellness summaries derived from
the user_analytics table (populated by the mood_tracker plugin).
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Dict, Optional
from datetime import date, datetime, timedelta, timezone

from app.core.database import get_db
from app.core.auth import get_current_user
from app.models.user import User
from app.models.plugin import UserAnalytics
from app.models.conversation import Conversation, Message

router = APIRouter()


# ── Response models ───────────────────────────────────────────────────────────

class MoodPoint(BaseModel):
    date: str           # YYYY-MM-DD
    mood: str
    emoji: str
    score: int          # 1-5 (struggling=1, great=5)
    note: Optional[str]


class StreakInfo(BaseModel):
    current: int        # consecutive days with a check-in
    longest: int        # all-time longest streak
    last_checkin: Optional[str]


class MoodDistribution(BaseModel):
    mood: str
    emoji: str
    count: int
    percentage: float


class WeekSummary(BaseModel):
    week_start: str
    average_score: float
    dominant_mood: Optional[str]
    dominant_emoji: Optional[str]
    checkin_count: int


class InsightsResponse(BaseModel):
    trend: List[MoodPoint]           # last 30 days, one per check-in
    streak: StreakInfo
    distribution: List[MoodDistribution]
    weekly_summaries: List[WeekSummary]
    total_messages: int
    total_conversations: int
    member_since: str


# ── Constants ─────────────────────────────────────────────────────────────────

MOOD_EMOJI: Dict[str, str] = {
    "great":      "😊",
    "good":       "🙂",
    "okay":       "😐",
    "tired":      "😴",
    "struggling": "😔",
}

MOOD_SCORE: Dict[str, int] = {
    "great":      5,
    "good":       4,
    "okay":       3,
    "tired":      2,
    "struggling": 1,
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_checkins(user_id: int, db: Session, days: int = 90) -> List[UserAnalytics]:
    since = datetime.combine(
        date.today() - timedelta(days=days),
        datetime.min.time()
    ).replace(tzinfo=timezone.utc)
    return (
        db.query(UserAnalytics)
        .filter(
            UserAnalytics.user_id == user_id,
            UserAnalytics.metric_type == "checkin",
            UserAnalytics.recorded_at >= since,
        )
        .order_by(UserAnalytics.recorded_at)
        .all()
    )


def _calc_streak(checkins: List[UserAnalytics]) -> StreakInfo:
    if not checkins:
        return StreakInfo(current=0, longest=0, last_checkin=None)

    # Unique days that have a check-in
    days_with_checkin = sorted({row.recorded_at.date() for row in checkins})
    today = date.today()

    # Current streak (counting backwards from today)
    current = 0
    check = today
    day_set = set(days_with_checkin)
    while check in day_set:
        current += 1
        check -= timedelta(days=1)
    # if nothing today and yesterday had one, treat yesterday as start
    if current == 0 and (today - timedelta(days=1)) in day_set:
        check = today - timedelta(days=1)
        while check in day_set:
            current += 1
            check -= timedelta(days=1)

    # Longest streak
    longest = 1
    run = 1
    for i in range(1, len(days_with_checkin)):
        if (days_with_checkin[i] - days_with_checkin[i - 1]).days == 1:
            run += 1
            longest = max(longest, run)
        else:
            run = 1

    last = days_with_checkin[-1].isoformat() if days_with_checkin else None
    return StreakInfo(current=current, longest=longest, last_checkin=last)


def _calc_distribution(points: List[MoodPoint]) -> List[MoodDistribution]:
    counts: Dict[str, int] = {}
    for p in points:
        counts[p.mood] = counts.get(p.mood, 0) + 1
    total = sum(counts.values()) or 1
    order = ["great", "good", "okay", "tired", "struggling"]
    result = []
    for mood in order:
        if mood in counts:
            result.append(MoodDistribution(
                mood=mood,
                emoji=MOOD_EMOJI.get(mood, ""),
                count=counts[mood],
                percentage=round(counts[mood] / total * 100, 1),
            ))
    return result


def _calc_weekly_summaries(points: List[MoodPoint]) -> List[WeekSummary]:
    weeks: Dict[date, List[MoodPoint]] = {}
    for p in points:
        d = date.fromisoformat(p.date)
        # Monday of that week
        monday = d - timedelta(days=d.weekday())
        weeks.setdefault(monday, []).append(p)

    summaries = []
    for monday in sorted(weeks.keys())[-8:]:  # last 8 weeks max
        week_points = weeks[monday]
        scores = [MOOD_SCORE.get(p.mood, 3) for p in week_points]
        avg = round(sum(scores) / len(scores), 2)

        # Dominant mood
        counts: Dict[str, int] = {}
        for p in week_points:
            counts[p.mood] = counts.get(p.mood, 0) + 1
        dominant = max(counts, key=counts.__getitem__) if counts else None

        summaries.append(WeekSummary(
            week_start=monday.isoformat(),
            average_score=avg,
            dominant_mood=dominant,
            dominant_emoji=MOOD_EMOJI.get(dominant, "") if dominant else "",
            checkin_count=len(week_points),
        ))
    return summaries


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/insights", response_model=InsightsResponse)
async def get_insights(
    days: int = 30,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Returns mood trend data, streak, distribution, and usage stats
    for the authenticated user.
    """
    checkins = _get_checkins(current_user.id, db, days=max(days, 90))

    trend: List[MoodPoint] = []
    for row in checkins:
        mood = row.metric_value.get("mood", "okay")
        trend.append(MoodPoint(
            date=row.recorded_at.strftime("%Y-%m-%d"),
            mood=mood,
            emoji=MOOD_EMOJI.get(mood, ""),
            score=MOOD_SCORE.get(mood, 3),
            note=row.metric_value.get("note") or None,
        ))

    # Trim trend to requested window
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    trend_window = [p for p in trend if p.date >= cutoff]

    streak = _calc_streak(checkins)
    distribution = _calc_distribution(trend)
    weekly = _calc_weekly_summaries(trend)

    # Usage stats
    total_msgs = (
        db.query(Message)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .filter(Conversation.user_id == current_user.id)
        .count()
    )
    total_convos = (
        db.query(Conversation)
        .filter(Conversation.user_id == current_user.id)
        .count()
    )
    member_since = current_user.created_at.strftime("%Y-%m-%d") if hasattr(current_user, "created_at") and current_user.created_at else "unknown"

    return InsightsResponse(
        trend=trend_window,
        streak=streak,
        distribution=distribution,
        weekly_summaries=weekly,
        total_messages=total_msgs,
        total_conversations=total_convos,
        member_since=member_since,
    )
