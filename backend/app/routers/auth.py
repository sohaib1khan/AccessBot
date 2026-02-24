# backend/app/routers/auth.py
from app.core.auth import get_current_user
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Optional, List
from app.core.database import get_db
from app.core.security import verify_password, get_password_hash, create_access_token
from app.models.user import User
from app.config import settings

router = APIRouter()

# ── Request / Response models ─────────────────────────────────────

class UserRegister(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: Optional[str] = None
    password: str = Field(..., min_length=6)

class UserLogin(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"

class UserResponse(BaseModel):
    id: int
    username: str
    email: Optional[str]

    class Config:
        from_attributes = True

class AccountUpdate(BaseModel):
    """Payload for PUT /auth/me — all fields optional."""
    new_username: Optional[str] = Field(None, min_length=3, max_length=50)
    new_email: Optional[str] = None
    current_password: Optional[str] = None   # required when changing password
    new_password: Optional[str] = Field(None, min_length=6)

# ── Helper ────────────────────────────────────────────────────────

def _user_count(db: Session) -> int:
    return db.query(User).count()

def _create_user(db: Session, username: str, password: str, email: Optional[str] = None) -> User:
    """Shared user-creation logic (checks duplicates, hashes password)."""
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Username already taken")
    if email and db.query(User).filter(User.email == email).first():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Email already registered")
    user = User(
        username=username,
        email=email,
        password_hash=get_password_hash(password),
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

# ── Public: setup status ──────────────────────────────────────────

@router.get("/setup-status")
async def setup_status(db: Session = Depends(get_db)):
    """
    Returns whether first-time setup is still required.
    The frontend uses this to show/hide the Register form.
    """
    count = _user_count(db)
    return {"setup_required": count == 0, "user_count": count}

# ── Public: first-time registration ──────────────────────────────

@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(user_data: UserRegister, db: Session = Depends(get_db)):
    """
    Self-registration — only allowed when no users exist yet (initial setup).
    After the first account is created, use the admin endpoint to add more users.
    """
    if _user_count(db) > 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Registration is closed. Ask an admin to create your account.",
        )
    return _create_user(db, user_data.username, user_data.password, user_data.email)

# ── Public: login ─────────────────────────────────────────────────

@router.post("/login", response_model=Token)
async def login(credentials: UserLogin, db: Session = Depends(get_db)):
    """Login and get access token"""
    user = db.query(User).filter(User.username == credentials.username).first()
    if not user or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect username or password")
    if not user.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Inactive user")
    access_token = create_access_token(
        data={"sub": str(user.id)},
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return {"access_token": access_token, "token_type": "bearer"}

# ── Authenticated: current user ───────────────────────────────────

@router.get("/me", response_model=UserResponse)
async def get_current_user_info(current_user: User = Depends(get_current_user)):
    """Get current user information"""
    return current_user

@router.put("/me", response_model=UserResponse)
async def update_account(
    data: AccountUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Update own username, email, or password.
    Current password is required when setting a new password.
    """
    # ── Username change
    if data.new_username and data.new_username != current_user.username:
        if db.query(User).filter(User.username == data.new_username).first():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Username already taken")
        current_user.username = data.new_username

    # ── Email change (allow clearing with empty string)
    if data.new_email is not None:
        new_email = data.new_email.strip() or None
        if new_email and new_email != current_user.email:
            if db.query(User).filter(User.email == new_email).first():
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Email already registered")
        current_user.email = new_email

    # ── Password change
    if data.new_password:
        if not data.current_password:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password required to set a new one")
        if not verify_password(data.current_password, current_user.password_hash):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
        current_user.password_hash = get_password_hash(data.new_password)

    db.commit()
    db.refresh(current_user)
    return current_user

# ── Admin: user management ────────────────────────────────────────
# Every authenticated user is treated as admin (single-tenant app).

@router.get("/users", response_model=List[UserResponse])
async def list_users(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all user accounts."""
    return db.query(User).order_by(User.id).all()

@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def admin_create_user(
    user_data: UserRegister,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Admin: create a new user account."""
    return _create_user(db, user_data.username, user_data.password, user_data.email)

@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Admin: delete a user account. Cannot delete your own account."""
    if user_id == current_user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot delete your own account")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    db.delete(user)
    db.commit()