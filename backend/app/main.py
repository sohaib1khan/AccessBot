# backend/app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.core.database import engine, Base

# Import routers
from app.routers import auth, chat, admin
from app.routers import plugins
from app.routers import voice
from app.routers import analytics
from app.routers import suggestions

# Import all models so Base.metadata knows about them
from app.models import user, conversation, settings as settings_model  # noqa: F401
from app.models import plugin as plugin_model                            # noqa: F401

# Register plugins with the plugin manager
from app.plugins.manager import plugin_manager
from app.plugins.daily_checkin.plugin import daily_checkin_plugin
from app.plugins.mood_tracker.plugin import mood_tracker_plugin
from app.plugins.recharge.plugin import recharge_plugin

plugin_manager.register(daily_checkin_plugin)
plugin_manager.register(mood_tracker_plugin)
plugin_manager.register(recharge_plugin)

# Create database tables
Base.metadata.create_all(bind=engine)

# Safe column migrations (add new columns to existing tables without breaking anything)
def _run_migrations():
    from sqlalchemy import text
    with engine.connect() as conn:
        # vision_enabled added in v2
        conn.execute(text(
            "ALTER TABLE user_ai_settings ADD COLUMN IF NOT EXISTS vision_enabled BOOLEAN DEFAULT false"
        ))
        conn.commit()

try:
    _run_migrations()
except Exception:
    pass  # Table may not exist yet (first run) — create_all above will handle it

# Initialize FastAPI app
app = FastAPI(
    title="AccessBot API",
    description="AI companion for people with disabilities",
    version="0.1.0",
    debug=settings.DEBUG
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health check endpoints
@app.get("/")
async def root():
    return {
        "message": "AccessBot API is running",
        "version": "0.1.0",
        "status": "healthy"
    }

@app.get("/health")
async def health_check():
    return {"status": "ok"}

# Include routers
app.include_router(auth.router, prefix="/auth", tags=["Authentication"])
app.include_router(chat.router, prefix="/chat", tags=["Chat"])
app.include_router(admin.router, prefix="/admin", tags=["Admin"])
app.include_router(plugins.router, prefix="/plugins", tags=["Plugins"])
app.include_router(voice.router, prefix="/voice", tags=["Voice"])
app.include_router(analytics.router, prefix="/analytics", tags=["Analytics"])
app.include_router(suggestions.router, prefix="/chat/suggestions", tags=["Suggestions"])