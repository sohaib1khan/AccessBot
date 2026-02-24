# backend/app/models/plugin.py
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, JSON
from sqlalchemy.sql import func
from app.core.database import Base


class UserPlugin(Base):
    """Tracks which plugins are enabled for each user"""
    __tablename__ = "user_plugins"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    plugin_name = Column(String(50), nullable=False)
    enabled = Column(Boolean, default=True)
    settings = Column(JSON, nullable=True)  # plugin-specific config

    def __repr__(self):
        return f"<UserPlugin(user_id={self.user_id}, plugin={self.plugin_name}, enabled={self.enabled})>"


class UserAnalytics(Base):
    """Stores mood, energy, and other plugin metrics per user"""
    __tablename__ = "user_analytics"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    metric_type = Column(String(50), nullable=False)  # 'mood', 'energy', 'checkin'
    metric_value = Column(JSON, nullable=False)        # flexible payload
    recorded_at = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f"<UserAnalytics(user_id={self.user_id}, type={self.metric_type})>"
