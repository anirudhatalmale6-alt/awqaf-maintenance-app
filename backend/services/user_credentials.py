import logging
from typing import Optional, Dict, Any, List

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from models.user_credentials import User_credentials

logger = logging.getLogger(__name__)


# ------------------ Service Layer ------------------
class User_credentialsService:
    """Service layer for User_credentials operations"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, data: Dict[str, Any]) -> Optional[User_credentials]:
        """Create a new user_credentials"""
        try:
            obj = User_credentials(**data)
            self.db.add(obj)
            await self.db.commit()
            await self.db.refresh(obj)
            logger.info(f"Created user_credentials with id: {obj.id}")
            return obj
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error creating user_credentials: {str(e)}")
            raise

    async def get_by_id(self, obj_id: int) -> Optional[User_credentials]:
        """Get user_credentials by ID"""
        try:
            query = select(User_credentials).where(User_credentials.id == obj_id)
            result = await self.db.execute(query)
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching user_credentials {obj_id}: {str(e)}")
            raise

    async def get_list(
        self, 
        skip: int = 0, 
        limit: int = 20, 
        query_dict: Optional[Dict[str, Any]] = None,
        sort: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get paginated list of user_credentialss"""
        try:
            query = select(User_credentials)
            count_query = select(func.count(User_credentials.id))
            
            if query_dict:
                for field, value in query_dict.items():
                    if hasattr(User_credentials, field):
                        query = query.where(getattr(User_credentials, field) == value)
                        count_query = count_query.where(getattr(User_credentials, field) == value)
            
            count_result = await self.db.execute(count_query)
            total = count_result.scalar()

            if sort:
                if sort.startswith('-'):
                    field_name = sort[1:]
                    if hasattr(User_credentials, field_name):
                        query = query.order_by(getattr(User_credentials, field_name).desc())
                else:
                    if hasattr(User_credentials, sort):
                        query = query.order_by(getattr(User_credentials, sort))
            else:
                query = query.order_by(User_credentials.id.desc())

            result = await self.db.execute(query.offset(skip).limit(limit))
            items = result.scalars().all()

            return {
                "items": items,
                "total": total,
                "skip": skip,
                "limit": limit,
            }
        except Exception as e:
            logger.error(f"Error fetching user_credentials list: {str(e)}")
            raise

    async def update(self, obj_id: int, update_data: Dict[str, Any]) -> Optional[User_credentials]:
        """Update user_credentials"""
        try:
            obj = await self.get_by_id(obj_id)
            if not obj:
                logger.warning(f"User_credentials {obj_id} not found for update")
                return None
            for key, value in update_data.items():
                if hasattr(obj, key):
                    setattr(obj, key, value)

            await self.db.commit()
            await self.db.refresh(obj)
            logger.info(f"Updated user_credentials {obj_id}")
            return obj
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error updating user_credentials {obj_id}: {str(e)}")
            raise

    async def delete(self, obj_id: int) -> bool:
        """Delete user_credentials"""
        try:
            obj = await self.get_by_id(obj_id)
            if not obj:
                logger.warning(f"User_credentials {obj_id} not found for deletion")
                return False
            await self.db.delete(obj)
            await self.db.commit()
            logger.info(f"Deleted user_credentials {obj_id}")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error deleting user_credentials {obj_id}: {str(e)}")
            raise

    async def get_by_field(self, field_name: str, field_value: Any) -> Optional[User_credentials]:
        """Get user_credentials by any field"""
        try:
            if not hasattr(User_credentials, field_name):
                raise ValueError(f"Field {field_name} does not exist on User_credentials")
            result = await self.db.execute(
                select(User_credentials).where(getattr(User_credentials, field_name) == field_value)
            )
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching user_credentials by {field_name}: {str(e)}")
            raise

    async def list_by_field(
        self, field_name: str, field_value: Any, skip: int = 0, limit: int = 20
    ) -> List[User_credentials]:
        """Get list of user_credentialss filtered by field"""
        try:
            if not hasattr(User_credentials, field_name):
                raise ValueError(f"Field {field_name} does not exist on User_credentials")
            result = await self.db.execute(
                select(User_credentials)
                .where(getattr(User_credentials, field_name) == field_value)
                .offset(skip)
                .limit(limit)
                .order_by(User_credentials.id.desc())
            )
            return result.scalars().all()
        except Exception as e:
            logger.error(f"Error fetching user_credentialss by {field_name}: {str(e)}")
            raise