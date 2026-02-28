from typing import Any
from app.plugins.base_plugin import BasePlugin


class KanbanBoardPlugin(BasePlugin):
    name = "kanban_board"
    display_name = "Task Board"
    description = "Track personal tasks with Backlog, Pending, In Progress, and Completed stages."

    async def get_context(self, user_id: int, db: Any) -> str | None:
        return None


kanban_board_plugin = KanbanBoardPlugin()
