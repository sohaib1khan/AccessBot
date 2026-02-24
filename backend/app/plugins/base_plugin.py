# backend/app/plugins/base_plugin.py
from abc import ABC, abstractmethod
from typing import Any


class BasePlugin(ABC):
    """
    All AccessBot plugins inherit from this class.
    Plugins are self-contained feature modules that can be enabled/disabled per user.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique plugin identifier (slug). e.g. 'daily_checkin'"""
        pass

    @property
    @abstractmethod
    def display_name(self) -> str:
        """Human-readable name shown in the UI."""
        pass

    @property
    @abstractmethod
    def description(self) -> str:
        """Short description shown in the plugin settings panel."""
        pass

    @abstractmethod
    async def get_context(self, user_id: int, db: Any) -> str | None:
        """
        Return a string of context to prepend to the AI system prompt, or None.
        Use this to inject user state (e.g. recent mood) so the AI is aware.
        """
        pass
