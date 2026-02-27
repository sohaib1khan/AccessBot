from typing import Any
from app.plugins.base_plugin import BasePlugin


class TaskBreakdownPlugin(BasePlugin):
    name = "task_breakdown"
    display_name = "Task Breakdown Coach"
    description = "Turns overwhelming tasks into clear micro-steps with suggested timer blocks."

    async def get_context(self, user_id: int, db: Any) -> str | None:
        return None


task_breakdown_plugin = TaskBreakdownPlugin()
