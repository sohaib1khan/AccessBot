from typing import Any
from app.plugins.base_plugin import BasePlugin


class KanbanBoardPlugin(BasePlugin):
    name = "kanban_board"
    display_name = "Kanban Board"
    description = "Simple personal board with Now, Next, and Done columns to organize tasks clearly."

    async def get_context(self, user_id: int, db: Any) -> str | None:
        return None


kanban_board_plugin = KanbanBoardPlugin()
