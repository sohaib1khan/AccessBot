# backend/app/routers/chat.py
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from sqlalchemy.sql import func
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timedelta, timezone
from app.core.database import get_db
from app.core.auth import get_current_user
from app.models.user import User
from app.models.conversation import Conversation, Message
from app.services.ai.router import ai_router
from app.plugins.manager import plugin_manager

router = APIRouter()

# Request/Response models
class ChatMessage(BaseModel):
    role: str  # 'user' or 'assistant'
    content: str

class ChatRequest(BaseModel):
    message: str
    conversation_id: int | None = None
    image_data: str | None = None   # base64 data URL e.g. "data:image/png;base64,..."

class ChatResponse(BaseModel):
    conversation_id: int
    message: str
    role: str = "assistant"

class RenameRequest(BaseModel):
    title: str

class ConversationSummary(BaseModel):
    id: int
    title: str | None
    updated_at: str | None

    class Config:
        from_attributes = True

class ConversationResponse(BaseModel):
    id: int
    title: str | None
    messages: List[ChatMessage]
    
    class Config:
        from_attributes = True

@router.post("/send", response_model=ChatResponse)
async def send_message(
    request: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Send a chat message and get AI response"""

    def _touch_conversation(conv: Conversation):
        conv.updated_at = func.now()
        db.add(conv)
        db.commit()
    
    # Get or create conversation
    if request.conversation_id:
        conversation = db.query(Conversation).filter(
            Conversation.id == request.conversation_id,
            Conversation.user_id == current_user.id
        ).first()
        
        if not conversation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found"
            )
    else:
        # Try to continue the most recent incomplete conversation first.
        # This prevents duplicate sessions when a prior request timed out.
        conversation = (
            db.query(Conversation)
            .filter(Conversation.user_id == current_user.id)
            .order_by(Conversation.updated_at.desc())
            .first()
        )

        should_reuse = False
        if conversation:
            last_message = (
                db.query(Message)
                .filter(Message.conversation_id == conversation.id)
                .order_by(Message.created_at.desc())
                .first()
            )
            if last_message and last_message.role == "user" and conversation.updated_at:
                conv_updated = conversation.updated_at
                if conv_updated.tzinfo is None:
                    conv_updated = conv_updated.replace(tzinfo=timezone.utc)
                should_reuse = (datetime.now(timezone.utc) - conv_updated) <= timedelta(minutes=20)

        if not should_reuse:
            conversation = Conversation(
                user_id=current_user.id,
                title=request.message[:50] if len(request.message) > 50 else request.message
            )
            db.add(conversation)
            db.commit()
            db.refresh(conversation)
    
    # Save user message — store as JSON if an image is attached
    import json as _json
    if request.image_data:
        stored_content = _json.dumps({"text": request.message, "image": request.image_data})
    else:
        stored_content = request.message

    user_message = Message(
        conversation_id=conversation.id,
        role="user",
        content=stored_content
    )
    db.add(user_message)
    db.commit()
    _touch_conversation(conversation)
    
    # Get conversation history
    messages = db.query(Message).filter(
        Message.conversation_id == conversation.id
    ).order_by(Message.created_at).all()
    
    # Get AI settings once so we know if vision is enabled
    ai_settings = await ai_router.get_user_settings(current_user.id, db)
    vision_enabled = ai_settings.get("vision_enabled", False)
    api_format = ai_settings.get("api_format", "openai")

    # Format messages for AI
    # When vision is enabled and the message has an image, build a multipart content array
    # (OpenAI vision format, also supported by LM Studio vision models)
    import json as _json
    def _build_ai_message(role: str, content: str):
        """Returns a message dict, using multipart content for user messages with images if vision is on."""
        try:
            parsed = _json.loads(content)
            if isinstance(parsed, dict) and "text" in parsed:
                text = parsed.get("text") or ""
                image = parsed.get("image") or ""
                if image and vision_enabled and api_format in ("openai", "ollama"):
                    # OpenAI vision multipart format (also used by LM Studio, Ollama)
                    return {
                        "role": role,
                        "content": [
                            {"type": "text", "text": text},
                            {"type": "image_url", "image_url": {"url": image}},
                        ]
                    }
                # Vision disabled or unsupported format — fall back to text with note
                img_note = " [User attached an image — vision is not enabled for this model]" if image else ""
                return {"role": role, "content": text + img_note}
        except Exception:
            pass
        return {"role": role, "content": content}

    ai_messages = [_build_ai_message(msg.role, msg.content) for msg in messages]
    
    # Prepend plugin context as a system message (if any plugins have context)
    plugin_context = await plugin_manager.collect_ai_context(current_user.id, db)
    if plugin_context:
        system_message = (
            "You are AccessBot, a compassionate AI companion designed to support people with disabilities. "
            "Always be kind, patient, and empathetic.\n\n"
            + plugin_context
        )
        ai_messages = [{"role": "system", "content": system_message}] + ai_messages
    
    # Get AI response
    try:
        ai_response = await ai_router.chat(current_user.id, ai_messages, db)
    except Exception as e:
        error_text = str(e)
        lowered = error_text.lower()
        timeout_like = any(t in lowered for t in ["timeout", "timed out", "too long to respond"])

        if timeout_like:
            fallback_message = (
                "I’m still working on your request, and this model is taking longer than usual to respond. "
                "Your message was saved to this same conversation, so please keep using this chat thread. "
                "If this keeps happening, try reducing response length (max tokens), choosing a smaller/faster model, "
                "or increasing your reverse-proxy timeout."
            )
            assistant_message = Message(
                conversation_id=conversation.id,
                role="assistant",
                content=fallback_message
            )
            db.add(assistant_message)
            db.commit()
            _touch_conversation(conversation)
            return {
                "conversation_id": conversation.id,
                "message": fallback_message,
                "role": "assistant"
            }

        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "message": f"AI service error: {error_text}",
                "conversation_id": conversation.id
            }
        )
    
    # Save AI response
    assistant_message = Message(
        conversation_id=conversation.id,
        role="assistant",
        content=ai_response
    )
    db.add(assistant_message)
    db.commit()
    _touch_conversation(conversation)
    
    return {
        "conversation_id": conversation.id,
        "message": ai_response,
        "role": "assistant"
    }

@router.get("/conversations", response_model=List[ConversationSummary])
async def get_conversations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get conversation list (summaries) for current user"""
    
    conversations = db.query(Conversation).filter(
        Conversation.user_id == current_user.id
    ).order_by(Conversation.updated_at.desc()).all()
    
    return [
        {
            "id": conv.id,
            "title": conv.title or "New Chat",
            "updated_at": conv.updated_at.isoformat() if conv.updated_at else None
        }
        for conv in conversations
    ]

@router.get("/search")
async def search_conversations(
    q: str = Query(..., min_length=1, max_length=200, description="Search query"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Full-text search across the user's messages."""
    term = f"%{q.strip()}%"
    # Find matching messages
    matches = (
        db.query(Message)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .filter(
            Conversation.user_id == current_user.id,
            Message.content.ilike(term),
        )
        .order_by(Message.created_at.desc())
        .limit(40)
        .all()
    )

    results = []
    seen_convos: set[int] = set()
    for msg in matches:
        conv = db.query(Conversation).filter(Conversation.id == msg.conversation_id).first()
        if not conv:
            continue
        snippet = msg.content[:160].replace("\n", " ")
        results.append({
            "conversation_id":    conv.id,
            "conversation_title": conv.title or "New Chat",
            "message_id":         msg.id,
            "role":               msg.role,
            "snippet":            snippet,
            "date":               msg.created_at.strftime("%Y-%m-%d") if msg.created_at else "",
        })
        seen_convos.add(conv.id)

    return {"query": q, "count": len(results), "results": results}


@router.delete("/conversations")
async def bulk_delete_conversations(
    data: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete multiple conversations by ID list"""
    ids = data.get("ids", [])
    if not ids or not isinstance(ids, list):
        raise HTTPException(status_code=400, detail="ids must be a non-empty list")
    # Only delete conversations belonging to this user
    convs = db.query(Conversation).filter(
        Conversation.id.in_(ids),
        Conversation.user_id == current_user.id
    ).all()
    deleted = []
    for conv in convs:
        db.query(Message).filter(Message.conversation_id == conv.id).delete()
        db.delete(conv)
        deleted.append(conv.id)
    db.commit()
    return {"deleted": deleted, "count": len(deleted)}


@router.patch("/conversations/{conversation_id}")
async def rename_conversation(
    conversation_id: int,
    data: RenameRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Rename a conversation"""
    conversation = db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.user_id == current_user.id
    ).first()
    if not conversation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    new_title = data.title.strip()
    if not new_title:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Title cannot be empty")
    conversation.title = new_title[:100]
    db.commit()
    return {"id": conversation.id, "title": conversation.title}


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a conversation and all its messages"""
    conversation = db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.user_id == current_user.id
    ).first()
    if not conversation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    db.query(Message).filter(Message.conversation_id == conversation_id).delete()
    db.delete(conversation)
    db.commit()
    return {"deleted": conversation_id}


@router.get("/conversations/{conversation_id}", response_model=ConversationResponse)
async def get_conversation(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Load a specific conversation with all messages"""
    
    conversation = db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.user_id == current_user.id
    ).first()
    
    if not conversation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found"
        )
    
    messages = db.query(Message).filter(
        Message.conversation_id == conversation.id
    ).order_by(Message.created_at).all()
    
    return {
        "id": conversation.id,
        "title": conversation.title,
        "messages": [
            {"role": msg.role, "content": msg.content}
            for msg in messages
        ]
    }