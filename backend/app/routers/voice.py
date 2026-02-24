# backend/app/routers/voice.py
import io
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Literal
from app.core.database import get_db
from app.core.auth import get_current_user
from app.models.user import User
from app.models.settings import UserAISettings

router = APIRouter()

TTS_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"]


# ── Request / Response models ────────────────────────────────────────────────

class VoiceSettingsUpdate(BaseModel):
    voice_api_key: str | None = None     # blank = keep existing
    tts_voice: Literal["alloy", "echo", "fable", "onyx", "nova", "shimmer"] = "nova"
    voice_enabled: bool = False


class VoiceSettingsResponse(BaseModel):
    tts_voice: str
    voice_enabled: bool
    has_voice_key: bool    # whether an API key for voice exists (never expose the key itself)


# ── Helper: get the OpenAI key to use for voice ──────────────────────────────

def _get_voice_key(settings: UserAISettings | None) -> str | None:
    if not settings:
        return None
    # Prefer dedicated voice key; fall back to main key when provider is OpenAI-compatible
    if settings.voice_api_key:
        return settings.voice_api_key
    if settings.api_format == "openai" and settings.api_key:
        return settings.api_key
    return None


# ── Voice settings ───────────────────────────────────────────────────────────

@router.get("/settings", response_model=VoiceSettingsResponse)
async def get_voice_settings(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    s = db.query(UserAISettings).first()
    if not s:
        return {"tts_voice": "nova", "voice_enabled": False, "has_voice_key": False}
    return {
        "tts_voice": s.tts_voice or "nova",
        "voice_enabled": s.voice_enabled or False,
        "has_voice_key": bool(_get_voice_key(s)),
    }


@router.post("/settings")
async def update_voice_settings(
    data: VoiceSettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    s = db.query(UserAISettings).first()
    if not s:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Configure your LLM settings first before saving voice settings."
        )
    if data.voice_api_key:           # only overwrite if a new key was provided
        s.voice_api_key = data.voice_api_key
    s.tts_voice = data.tts_voice
    s.voice_enabled = data.voice_enabled
    db.commit()
    return {"message": "Voice settings saved."}


# ── Speech-to-Text (Whisper) ─────────────────────────────────────────────────

@router.post("/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Accept an audio file (webm/mp4/wav/mp3) and return the transcript.
    Uses OpenAI Whisper via the openai library.
    """
    from openai import AsyncOpenAI

    s = db.query(UserAISettings).first()
    api_key = _get_voice_key(s)

    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No OpenAI API key configured for voice. Add one in Settings → Voice."
        )

    # Read the uploaded audio into memory
    audio_bytes = await file.read()
    if len(audio_bytes) == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty audio file.")

    # Whisper needs a file-like object with a name so it can infer the format
    audio_file = io.BytesIO(audio_bytes)
    audio_file.name = file.filename or "recording.webm"

    try:
        client = AsyncOpenAI(api_key=api_key)
        transcript = await client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            response_format="text"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Whisper transcription failed: {str(e)}"
        )

    return {"transcript": transcript.strip() if isinstance(transcript, str) else str(transcript)}


# ── Text-to-Speech ────────────────────────────────────────────────────────────

class TTSRequest(BaseModel):
    text: str
    voice: str | None = None    # overrides user setting if provided


@router.post("/speak")
async def text_to_speech(
    request: TTSRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Convert text to speech using OpenAI TTS and stream the mp3 audio back.
    """
    from openai import AsyncOpenAI

    if not request.text.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No text provided.")

    # Cap length to avoid huge TTS bills
    text = request.text[:4096]

    s = db.query(UserAISettings).first()
    api_key = _get_voice_key(s)

    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No OpenAI API key configured for voice. Add one in Settings → Voice."
        )

    voice = request.voice or (s.tts_voice if s else "nova")
    if voice not in TTS_VOICES:
        voice = "nova"

    try:
        client = AsyncOpenAI(api_key=api_key)
        response = await client.audio.speech.create(
            model="tts-1",
            voice=voice,
            input=text,
            response_format="mp3"
        )
        audio_bytes = response.content
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"TTS failed: {str(e)}"
        )

    return StreamingResponse(
        io.BytesIO(audio_bytes),
        media_type="audio/mpeg",
        headers={"Content-Disposition": "inline; filename=speech.mp3"}
    )
