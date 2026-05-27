import logging
from typing import Optional, Dict, Any, List

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from models.email_settings import Email_settings

logger = logging.getLogger(__name__)


# ------------------ Service Layer ------------------
class Email_settingsService:
    """Service layer for Email_settings operations"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, data: Dict[str, Any]) -> Optional[Email_settings]:
        """Create a new email_settings"""
        try:
            obj = Email_settings(**data)
            self.db.add(obj)
            await self.db.commit()
            await self.db.refresh(obj)
            logger.info(f"Created email_settings with id: {obj.id}")
            return obj
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error creating email_settings: {str(e)}")
            raise

    async def get_by_id(self, obj_id: int) -> Optional[Email_settings]:
        """Get email_settings by ID"""
        try:
            query = select(Email_settings).where(Email_settings.id == obj_id)
            result = await self.db.execute(query)
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching email_settings {obj_id}: {str(e)}")
            raise

    async def get_list(
        self, 
        skip: int = 0, 
        limit: int = 20, 
        query_dict: Optional[Dict[str, Any]] = None,
        sort: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get paginated list of email_settingss"""
        try:
            query = select(Email_settings)
            count_query = select(func.count(Email_settings.id))
            
            if query_dict:
                for field, value in query_dict.items():
                    if hasattr(Email_settings, field):
                        query = query.where(getattr(Email_settings, field) == value)
                        count_query = count_query.where(getattr(Email_settings, field) == value)
            
            count_result = await self.db.execute(count_query)
            total = count_result.scalar()

            if sort:
                if sort.startswith('-'):
                    field_name = sort[1:]
                    if hasattr(Email_settings, field_name):
                        query = query.order_by(getattr(Email_settings, field_name).desc())
                else:
                    if hasattr(Email_settings, sort):
                        query = query.order_by(getattr(Email_settings, sort))
            else:
                query = query.order_by(Email_settings.id.desc())

            result = await self.db.execute(query.offset(skip).limit(limit))
            items = result.scalars().all()

            return {
                "items": items,
                "total": total,
                "skip": skip,
                "limit": limit,
            }
        except Exception as e:
            logger.error(f"Error fetching email_settings list: {str(e)}")
            raise

    async def update(self, obj_id: int, update_data: Dict[str, Any]) -> Optional[Email_settings]:
        """Update email_settings"""
        try:
            obj = await self.get_by_id(obj_id)
            if not obj:
                logger.warning(f"Email_settings {obj_id} not found for update")
                return None
            for key, value in update_data.items():
                if hasattr(obj, key):
                    setattr(obj, key, value)

            await self.db.commit()
            await self.db.refresh(obj)
            logger.info(f"Updated email_settings {obj_id}")
            return obj
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error updating email_settings {obj_id}: {str(e)}")
            raise

    async def delete(self, obj_id: int) -> bool:
        """Delete email_settings"""
        try:
            obj = await self.get_by_id(obj_id)
            if not obj:
                logger.warning(f"Email_settings {obj_id} not found for deletion")
                return False
            await self.db.delete(obj)
            await self.db.commit()
            logger.info(f"Deleted email_settings {obj_id}")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error deleting email_settings {obj_id}: {str(e)}")
            raise

    async def get_by_field(self, field_name: str, field_value: Any) -> Optional[Email_settings]:
        """Get email_settings by any field"""
        try:
            if not hasattr(Email_settings, field_name):
                raise ValueError(f"Field {field_name} does not exist on Email_settings")
            result = await self.db.execute(
                select(Email_settings).where(getattr(Email_settings, field_name) == field_value)
            )
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching email_settings by {field_name}: {str(e)}")
            raise

    async def list_by_field(
        self, field_name: str, field_value: Any, skip: int = 0, limit: int = 20
    ) -> List[Email_settings]:
        """Get list of email_settingss filtered by field"""
        try:
            if not hasattr(Email_settings, field_name):
                raise ValueError(f"Field {field_name} does not exist on Email_settings")
            result = await self.db.execute(
                select(Email_settings)
                .where(getattr(Email_settings, field_name) == field_value)
                .offset(skip)
                .limit(limit)
                .order_by(Email_settings.id.desc())
            )
            return result.scalars().all()
        except Exception as e:
            logger.error(f"Error fetching email_settingss by {field_name}: {str(e)}")
            raise