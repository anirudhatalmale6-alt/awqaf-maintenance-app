import logging
from typing import Optional, Dict, Any, List

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from models.custom_texts import Custom_texts

logger = logging.getLogger(__name__)


# ------------------ Service Layer ------------------
class Custom_textsService:
    """Service layer for Custom_texts operations"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, data: Dict[str, Any]) -> Optional[Custom_texts]:
        """Create a new custom_texts"""
        try:
            obj = Custom_texts(**data)
            self.db.add(obj)
            await self.db.commit()
            await self.db.refresh(obj)
            logger.info(f"Created custom_texts with id: {obj.id}")
            return obj
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error creating custom_texts: {str(e)}")
            raise

    async def get_by_id(self, obj_id: int) -> Optional[Custom_texts]:
        """Get custom_texts by ID"""
        try:
            query = select(Custom_texts).where(Custom_texts.id == obj_id)
            result = await self.db.execute(query)
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching custom_texts {obj_id}: {str(e)}")
            raise

    async def get_list(
        self, 
        skip: int = 0, 
        limit: int = 20, 
        query_dict: Optional[Dict[str, Any]] = None,
        sort: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get paginated list of custom_textss"""
        try:
            query = select(Custom_texts)
            count_query = select(func.count(Custom_texts.id))
            
            if query_dict:
                for field, value in query_dict.items():
                    if hasattr(Custom_texts, field):
                        query = query.where(getattr(Custom_texts, field) == value)
                        count_query = count_query.where(getattr(Custom_texts, field) == value)
            
            count_result = await self.db.execute(count_query)
            total = count_result.scalar()

            if sort:
                if sort.startswith('-'):
                    field_name = sort[1:]
                    if hasattr(Custom_texts, field_name):
                        query = query.order_by(getattr(Custom_texts, field_name).desc())
                else:
                    if hasattr(Custom_texts, sort):
                        query = query.order_by(getattr(Custom_texts, sort))
            else:
                query = query.order_by(Custom_texts.id.desc())

            result = await self.db.execute(query.offset(skip).limit(limit))
            items = result.scalars().all()

            return {
                "items": items,
                "total": total,
                "skip": skip,
                "limit": limit,
            }
        except Exception as e:
            logger.error(f"Error fetching custom_texts list: {str(e)}")
            raise

    async def update(self, obj_id: int, update_data: Dict[str, Any]) -> Optional[Custom_texts]:
        """Update custom_texts"""
        try:
            obj = await self.get_by_id(obj_id)
            if not obj:
                logger.warning(f"Custom_texts {obj_id} not found for update")
                return None
            for key, value in update_data.items():
                if hasattr(obj, key):
                    setattr(obj, key, value)

            await self.db.commit()
            await self.db.refresh(obj)
            logger.info(f"Updated custom_texts {obj_id}")
            return obj
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error updating custom_texts {obj_id}: {str(e)}")
            raise

    async def delete(self, obj_id: int) -> bool:
        """Delete custom_texts"""
        try:
            obj = await self.get_by_id(obj_id)
            if not obj:
                logger.warning(f"Custom_texts {obj_id} not found for deletion")
                return False
            await self.db.delete(obj)
            await self.db.commit()
            logger.info(f"Deleted custom_texts {obj_id}")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error deleting custom_texts {obj_id}: {str(e)}")
            raise

    async def get_by_field(self, field_name: str, field_value: Any) -> Optional[Custom_texts]:
        """Get custom_texts by any field"""
        try:
            if not hasattr(Custom_texts, field_name):
                raise ValueError(f"Field {field_name} does not exist on Custom_texts")
            result = await self.db.execute(
                select(Custom_texts).where(getattr(Custom_texts, field_name) == field_value)
            )
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching custom_texts by {field_name}: {str(e)}")
            raise

    async def list_by_field(
        self, field_name: str, field_value: Any, skip: int = 0, limit: int = 20
    ) -> List[Custom_texts]:
        """Get list of custom_textss filtered by field"""
        try:
            if not hasattr(Custom_texts, field_name):
                raise ValueError(f"Field {field_name} does not exist on Custom_texts")
            result = await self.db.execute(
                select(Custom_texts)
                .where(getattr(Custom_texts, field_name) == field_value)
                .offset(skip)
                .limit(limit)
                .order_by(Custom_texts.id.desc())
            )
            return result.scalars().all()
        except Exception as e:
            logger.error(f"Error fetching custom_textss by {field_name}: {str(e)}")
            raise