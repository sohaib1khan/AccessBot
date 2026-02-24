# backend/app/plugins/manager.py
from typing import Dict, List
from sqlalchemy.orm import Session
from app.plugins.base_plugin import BasePlugin
from app.models.plugin import UserPlugin


class PluginManager:
    """
    Central registry for all AccessBot plugins.
    Plugins are registered once at startup; enable/disable is per-user in the database.
    """

    def __init__(self):
        self._registry: Dict[str, BasePlugin] = {}

    def register(self, plugin: BasePlugin):
        """Register a plugin with the manager."""
        self._registry[plugin.name] = plugin

    def all_plugins(self) -> List[BasePlugin]:
        return list(self._registry.values())

    def get(self, name: str) -> BasePlugin | None:
        return self._registry.get(name)

    # ── Per-user enable/disable ──────────────────────────────────────────────

    def is_enabled(self, plugin_name: str, user_id: int, db: Session) -> bool:
        """Return True if user has this plugin enabled (defaults to True if no row yet)."""
        row = db.query(UserPlugin).filter(
            UserPlugin.user_id == user_id,
            UserPlugin.plugin_name == plugin_name
        ).first()
        return row.enabled if row else True   # enabled by default

    def set_enabled(self, plugin_name: str, user_id: int, enabled: bool, db: Session):
        """Enable or disable a plugin for a specific user."""
        row = db.query(UserPlugin).filter(
            UserPlugin.user_id == user_id,
            UserPlugin.plugin_name == plugin_name
        ).first()

        if row:
            row.enabled = enabled
        else:
            row = UserPlugin(user_id=user_id, plugin_name=plugin_name, enabled=enabled)
            db.add(row)

        db.commit()

    # ── AI context collection ────────────────────────────────────────────────

    async def collect_ai_context(self, user_id: int, db: Session) -> str:
        """
        Gather context strings from all enabled plugins and return a combined
        system-prompt addition. Returns empty string if nothing to add.
        """
        parts = []
        for plugin in self._registry.values():
            if self.is_enabled(plugin.name, user_id, db):
                try:
                    ctx = await plugin.get_context(user_id, db)
                    if ctx:
                        parts.append(ctx)
                except Exception:
                    pass   # never let a plugin break the chat

        return "\n\n".join(parts)


# Singleton used across the app
plugin_manager = PluginManager()
