# backend/app/models/settings.py
from sqlalchemy import Column, Integer, String, Float, Text, DateTime, Boolean, ForeignKey, JSON
from sqlalchemy.sql import func
from app.core.database import Base

class UserAISettings(Base):
    __tablename__ = "user_ai_settings"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)
    
    # Generic provider configuration
    provider_name = Column(String(100), nullable=False, default="claude")
    api_format = Column(String(20), nullable=False, default="anthropic")
    api_endpoint = Column(String(500), nullable=False)
    
    # Authentication
    api_key = Column(Text, nullable=True)
    auth_type = Column(String(20), default="bearer")
    custom_headers = Column(JSON, nullable=True)
    
    # Model configuration
    model_name = Column(String(100), nullable=True)
    temperature = Column(Float, default=0.7)
    max_tokens = Column(Integer, default=1000)
    
    # Additional parameters (provider-specific)
    extra_params = Column(JSON, nullable=True)
    
    # Voice settings (OpenAI Whisper STT + TTS)
    voice_api_key = Column(Text, nullable=True)     # OpenAI key for voice (falls back to api_key)
    tts_voice = Column(String(20), default="nova")  # alloy|echo|fable|onyx|nova|shimmer
    voice_enabled = Column(Boolean, default=False)  # auto-speak AI replies

    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    def __repr__(self):
        return f"<UserAISettings(user_id={self.user_id}, provider={self.provider_name})>"