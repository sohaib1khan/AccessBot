# backend/app/routers/admin.py
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Dict, Any
from app.core.database import get_db
from app.core.auth import get_current_user
from app.models.user import User
from app.models.settings import UserAISettings
from app.models.conversation import Conversation, Message
from app.models.plugin import UserAnalytics

router = APIRouter()

# Request/Response models
class LLMSettings(BaseModel):
    provider_name: str
    api_format: str  # 'openai', 'anthropic', 'ollama', 'custom'
    api_endpoint: str
    api_key: str | None = None
    model_name: str | None = None
    temperature: float = 0.7
    max_tokens: int = 1000
    auth_type: str = "bearer"
    custom_headers: Dict[str, str] | None = None
    extra_params: Dict[str, Any] | None = None

class LLMSettingsResponse(BaseModel):
    provider_name: str
    api_format: str
    api_endpoint: str
    model_name: str | None
    temperature: float
    max_tokens: int
    auth_type: str
    custom_headers: Dict[str, str] | None
    extra_params: Dict[str, Any] | None
    # Don't expose API key in response

@router.get("/settings", response_model=LLMSettingsResponse)
async def get_settings(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get global LLM settings (shared across all users)"""

    settings = db.query(UserAISettings).first()

    if not settings:
        # Return defaults
        return {
            "provider_name": "Unconfigured",
            "api_format": "openai",
            "api_endpoint": "",
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
        "model_name": settings.model_name,
        "temperature": settings.temperature,
        "max_tokens": settings.max_tokens,
        "auth_type": settings.auth_type,
        "custom_headers": settings.custom_headers,
        "extra_params": settings.extra_params
    }

@router.post("/settings")
async def update_settings(
    settings_data: LLMSettings,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update global LLM settings (shared across all users)"""

    # Always operate on the single shared settings row
    settings = db.query(UserAISettings).first()

    if settings:
        settings.provider_name = settings_data.provider_name
        settings.api_format = settings_data.api_format
        settings.api_endpoint = settings_data.api_endpoint
        settings.model_name = settings_data.model_name
        settings.temperature = settings_data.temperature
        settings.max_tokens = settings_data.max_tokens
        settings.auth_type = settings_data.auth_type
        settings.custom_headers = settings_data.custom_headers
        settings.extra_params = settings_data.extra_params
        if settings_data.api_key:
            settings.api_key = settings_data.api_key
    else:
        # No row yet — create the global one tied to whoever configures first
        settings = UserAISettings(
            user_id=current_user.id,
            provider_name=settings_data.provider_name,
            api_format=settings_data.api_format,
            api_endpoint=settings_data.api_endpoint,
            api_key=settings_data.api_key,
            model_name=settings_data.model_name,
            temperature=settings_data.temperature,
            max_tokens=settings_data.max_tokens,
            auth_type=settings_data.auth_type,
            custom_headers=settings_data.custom_headers,
            extra_params=settings_data.extra_params
        )
        db.add(settings)

    db.commit()
    return {"message": "Settings updated successfully"}

@router.post("/test")
async def test_connection(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Test the current LLM configuration without creating any conversation."""
    from app.services.ai.router import AIRouter
    router_ai = AIRouter()
    try:
        settings = await router_ai.get_user_settings(current_user.id, db)
        if not settings.get("api_endpoint"):
            raise HTTPException(status_code=400, detail="No LLM configured. Save your settings first.")
        response = await router_ai.provider.chat(
            [{"role": "user", "content": "Reply with only the word: OK"}],
            settings
        )
        return {"message": "Connection successful!", "response": response}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))

# LLM provider templates for easy configuration
@router.get("/templates")
async def get_provider_templates():
    """Get pre-configured templates for popular providers"""
    
    return {
        "templates": [
            {
                "name": "Claude (Anthropic)",
                "provider_name": "Claude",
                "api_format": "anthropic",
                "api_endpoint": "https://api.anthropic.com/v1/messages",
                "model_name": "claude-sonnet-4-20250514",
                "auth_type": "bearer"
            },
            {
                "name": "OpenAI",
                "provider_name": "OpenAI",
                "api_format": "openai",
                "api_endpoint": "https://api.openai.com/v1/chat/completions",
                "model_name": "gpt-4",
                "auth_type": "bearer"
            },
            {
                "name": "LM Studio (Local)",
                "provider_name": "LM Studio",
                "api_format": "openai",
                "api_endpoint": "http://localhost:1234/v1/chat/completions",
                "model_name": "",
                "auth_type": "none"
            },
            {
                "name": "Ollama (Local)",
                "provider_name": "Ollama",
                "api_format": "ollama",
                "api_endpoint": "http://localhost:11434/api/chat",
                "model_name": "llama2",
                "auth_type": "none"
            },
            {
                "name": "Groq",
                "provider_name": "Groq",
                "api_format": "openai",
                "api_endpoint": "https://api.groq.com/openai/v1/chat/completions",
                "model_name": "llama-3.1-70b-versatile",
                "auth_type": "bearer"
            },
            {
                "name": "Together.ai",
                "provider_name": "Together",
                "api_format": "openai",
                "api_endpoint": "https://api.together.xyz/v1/chat/completions",
                "model_name": "meta-llama/Llama-3-70b-chat-hf",
                "auth_type": "bearer"
            },
            {
                "name": "Custom",
                "provider_name": "Custom Provider",
                "api_format": "openai",
                "api_endpoint": "https://your-api.com/v1/chat/completions",
                "model_name": "your-model",
                "auth_type": "bearer"
            }
        ]
    }


@router.get("/export")
async def export_user_data(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Download all user data as JSON.
    Includes: profile, all conversations + messages, mood history.
    API keys are NOT exported for security.
    """
    conversations = (
        db.query(Conversation)
        .filter(Conversation.user_id == current_user.id)
        .order_by(Conversation.created_at)
        .all()
    )

    export_convos = []
    for conv in conversations:
        msgs = (
            db.query(Message)
            .filter(Message.conversation_id == conv.id)
            .order_by(Message.created_at)
            .all()
        )
        export_convos.append({
            "id": conv.id,
            "title": conv.title,
            "created_at": conv.created_at.isoformat() if conv.created_at else None,
            "updated_at": conv.updated_at.isoformat() if conv.updated_at else None,
            "messages": [
                {
                    "role": m.role,
                    "content": m.content,
                    "created_at": m.created_at.isoformat() if m.created_at else None,
                }
                for m in msgs
            ],
        })

    mood_rows = (
        db.query(UserAnalytics)
        .filter(
            UserAnalytics.user_id == current_user.id,
            UserAnalytics.metric_type == "checkin",
        )
        .order_by(UserAnalytics.recorded_at)
        .all()
    )

    export_mood = [
        {
            "mood":        row.metric_value.get("mood"),
            "note":        row.metric_value.get("note"),
            "recorded_at": row.recorded_at.isoformat() if row.recorded_at else None,
        }
        for row in mood_rows
    ]

    payload = {
        "export_version": "1.0",
        "exported_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "profile": {
            "username": current_user.username,
            "email": current_user.email,
            "member_since": current_user.created_at.isoformat() if current_user.created_at else None,
        },
        "conversations": export_convos,
        "mood_history": export_mood,
    }

    return JSONResponse(
        content=payload,
        headers={
            "Content-Disposition": f'attachment; filename="accessbot_export_{current_user.username}.json"'
        },
    )