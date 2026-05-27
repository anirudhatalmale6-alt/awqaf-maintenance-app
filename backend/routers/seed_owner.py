import logging
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.auth import User
from models.user_credentials import User_credentials
from routers.custom_auth import hash_password

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/seed", tags=["seed"])


@router.post("/owner")
async def seed_owner_account(
    db: AsyncSession = Depends(get_db),
):
    """One-time seed endpoint to create the Owner account.
    Returns success if already exists or newly created."""
    try:
        # Check if owner already exists by username
        existing_query = select(User_credentials).where(
            User_credentials.username == "owner"
        )
        existing_result = await db.execute(existing_query)
        existing_cred = existing_result.scalar_one_or_none()

        if existing_cred:
            return {"message": "Owner account already exists", "user_id": existing_cred.user_id}

        now = datetime.now(timezone.utc)
        user_id = secrets.token_hex(16)
        password_hashed = hash_password("Mr-Faisal2026")

        # Create user credentials
        cred = User_credentials(
            user_id=user_id,
            username="owner",
            password_hash=password_hashed,
            recovery_email="Faisal-f-bofarah@hotmail.com",
            created_at=now,
            updated_at=now,
        )
        db.add(cred)

        # Create user record with "owner" role
        new_user = User(
            id=user_id,
            email="Faisal-f-bofarah@hotmail.com",
            name="Owner",
            role="owner",
            created_at=now,
            last_login=now,
        )
        db.add(new_user)

        await db.commit()

        logger.info(f"Owner account created with user_id: {user_id}")
        return {"message": "Owner account created successfully", "user_id": user_id}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error creating owner account: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create owner account: {str(e)}")