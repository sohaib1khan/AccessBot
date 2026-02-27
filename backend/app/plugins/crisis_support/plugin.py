from typing import Any
from app.plugins.base_plugin import BasePlugin


class CrisisSupportPlugin(BasePlugin):
    name = "crisis_support"
    display_name = "Urgent Support Chat"
    description = "Separate urgent session chat focused on grounding, de-escalation, and step-by-step coping support."

    async def get_context(self, user_id: int, db: Any) -> str | None:
        return None


crisis_support_plugin = CrisisSupportPlugin()
