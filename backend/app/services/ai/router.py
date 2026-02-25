# backend/app/services/ai/router.py
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from app.services.ai.base import AIProvider
from app.services.ai.generic import GenericLLMProvider
from app.models.settings import UserAISettings

class AIRouter:
    """Routes AI requests to generic provider with user configuration"""
    
    def __init__(self):
        # Only one provider now - generic!
        self.provider = GenericLLMProvider()
    
    async def get_user_settings(self, user_id: int, db: Session) -> Dict[str, Any]:
        """Get global LLM configuration (shared across all users)"""

        settings = db.query(UserAISettings).first()
        
        if not settings:
            # Return default settings (placeholder - won't work until configured)
            return {
                "provider_name": "unconfigured",
                "api_format": "openai",
                "api_endpoint": "",
                "api_key": "",
                "model_name": "",
                "temperature": 0.7,
                "max_tokens": 1000,
                "auth_type": "none",
                "custom_headers": {},
                "extra_params": {}
            }
        
        return {
            "provider_name": settings.provider_name,
            "api_format": settings.api_format,
            "api_endpoint": settings.api_endpoint,
            "api_key": settings.api_key,  # TODO: decrypt this
            "model_name": settings.model_name,
            "temperature": settings.temperature,
            "max_tokens": settings.max_tokens,
            "auth_type": settings.auth_type,
            "custom_headers": settings.custom_headers or {},
            "extra_params": settings.extra_params or {},
            "vision_enabled": settings.vision_enabled or False,
        }
    
    async def chat(self, user_id: int, messages: List[Dict[str, str]], db: Session) -> str:
        """Send chat request using user's configured LLM"""
        
        # Get user settings
        settings = await self.get_user_settings(user_id, db)
        
        # Check if configured
        if settings.get("provider_name") == "unconfigured" or not settings.get("api_endpoint"):
            raise ValueError("LLM not configured. Please configure your AI provider in settings.")
        
        # Use generic provider with user's configuration
        return await self.provider.chat(messages, settings)

# Global router instance
ai_router = AIRouter()