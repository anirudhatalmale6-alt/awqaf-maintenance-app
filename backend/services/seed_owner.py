import logging
import secrets
from datetime import datetime, timezone

from core.database import db_manager
from models.auth import User
from models.user_credentials import User_credentials
from routers.custom_auth import hash_password
from sqlalchemy import select

logger = logging.getLogger(__name__)


async def initialize_owner_account():
    """Auto-seed the hidden Owner account on startup. Idempotent - safe to call multiple times."""
    try:
        async with db_manager.async_session_maker() as db:
            # Check if owner already exists by username
            existing_query = select(User_credentials).where(
                User_credentials.username == "owner"
            )
            existing_result = await db.execute(existing_query)
            existing_cred = existing_result.scalar_one_or_none()

            if existing_cred:
                # Ensure the User record also exists with "owner" role
                user_query = select(User).where(User.id == existing_cred.user_id)
                user_result = await db.execute(user_query)
                existing_user = user_result.scalar_one_or_none()
                if existing_user:
                    if existing_user.role != "owner":
                        existing_user.role = "owner"
                        await db.commit()
                        logger.info(f"Updated existing owner user role to 'owner'")
                else:
                    # Create missing User record
                    now = datetime.now(timezone.utc)
                    new_user = User(
                        id=existing_cred.user_id,
                        email=existing_cred.recovery_email or "Faisal-f-bofarah@hotmail.com",
                        name="Owner",
                        role="owner",
                        created_at=now,
                        last_login=now,
                    )
                    db.add(new_user)
                    await db.commit()
                    logger.info(f"Created missing User record for owner")
                logger.info("Owner account already exists, skipping seed")
                return

            # Create new owner account
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

    except Exception as e:
        logger.error(f"Error initializing owner account: {str(e)}", exc_info=True)