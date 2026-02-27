from typing import Any
from app.plugins.base_plugin import BasePlugin


class GoalStreaksPlugin(BasePlugin):
    name = "goal_streaks"
    display_name = "Goal Streaks"
    description = "Create small goals, track completion, and maintain gentle streaks with no-pressure resets."

    async def get_context(self, user_id: int, db: Any) -> str | None:
        return None


goal_streaks_plugin = GoalStreaksPlugin()
