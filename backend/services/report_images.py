import logging
from typing import Optional, Dict, Any, List

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from models.report_images import Report_images

logger = logging.getLogger(__name__)


# ------------------ Service Layer ------------------
class Report_imagesService:
    """Service layer for Report_images operations"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, data: Dict[str, Any]) -> Optional[Report_images]:
        """Create a new report_images"""
        try:
            obj = Report_images(**data)
            self.db.add(obj)
            await self.db.commit()
            await self.db.refresh(obj)
            logger.info(f"Created report_images with id: {obj.id}")
            return obj
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error creating report_images: {str(e)}")
            raise

    async def get_by_id(self, obj_id: int) -> Optional[Report_images]:
        """Get report_images by ID"""
        try:
            query = select(Report_images).where(Report_images.id == obj_id)
            result = await self.db.execute(query)
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching report_images {obj_id}: {str(e)}")
            raise

    async def get_list(
        self, 
        skip: int = 0, 
        limit: int = 20, 
        query_dict: Optional[Dict[str, Any]] = None,
        sort: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get paginated list of report_imagess"""
        try:
            query = select(Report_images)
            count_query = select(func.count(Report_images.id))
            
            if query_dict:
                for field, value in query_dict.items():
                    if hasattr(Report_images, field):
                        query = query.where(getattr(Report_images, field) == value)
                        count_query = count_query.where(getattr(Report_images, field) == value)
            
            count_result = await self.db.execute(count_query)
            total = count_result.scalar()

            if sort:
                if sort.startswith('-'):
                    field_name = sort[1:]
                    if hasattr(Report_images, field_name):
                        query = query.order_by(getattr(Report_images, field_name).desc())
                else:
                    if hasattr(Report_images, sort):
                        query = query.order_by(getattr(Report_images, sort))
            else:
                query = query.order_by(Report_images.id.desc())

            result = await self.db.execute(query.offset(skip).limit(limit))
            items = result.scalars().all()

            return {
                "items": items,
                "total": total,
                "skip": skip,
                "limit": limit,
            }
        except Exception as e:
            logger.error(f"Error fetching report_images list: {str(e)}")
            raise

    async def update(self, obj_id: int, update_data: Dict[str, Any]) -> Optional[Report_images]:
        """Update report_images"""
        try:
            obj = await self.get_by_id(obj_id)
            if not obj:
                logger.warning(f"Report_images {obj_id} not found for update")
                return None
            for key, value in update_data.items():
                if hasattr(obj, key):
                    setattr(obj, key, value)

            await self.db.commit()
            await self.db.refresh(obj)
            logger.info(f"Updated report_images {obj_id}")
            return obj
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error updating report_images {obj_id}: {str(e)}")
            raise

    async def delete(self, obj_id: int) -> bool:
        """Delete report_images"""
        try:
            obj = await self.get_by_id(obj_id)
            if not obj:
                logger.warning(f"Report_images {obj_id} not found for deletion")
                return False
            await self.db.delete(obj)
            await self.db.commit()
            logger.info(f"Deleted report_images {obj_id}")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error deleting report_images {obj_id}: {str(e)}")
            raise

    async def get_by_field(self, field_name: str, field_value: Any) -> Optional[Report_images]:
        """Get report_images by any field"""
        try:
            if not hasattr(Report_images, field_name):
                raise ValueError(f"Field {field_name} does not exist on Report_images")
            result = await self.db.execute(
                select(Report_images).where(getattr(Report_images, field_name) == field_value)
            )
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching report_images by {field_name}: {str(e)}")
            raise

    async def list_by_field(
        self, field_name: str, field_value: Any, skip: int = 0, limit: int = 20
    ) -> List[Report_images]:
        """Get list of report_imagess filtered by field"""
        try:
            if not hasattr(Report_images, field_name):
                raise ValueError(f"Field {field_name} does not exist on Report_images")
            result = await self.db.execute(
                select(Report_images)
                .where(getattr(Report_images, field_name) == field_value)
                .offset(skip)
                .limit(limit)
                .order_by(Report_images.id.desc())
            )
            return result.scalars().all()
        except Exception as e:
            logger.error(f"Error fetching report_imagess by {field_name}: {str(e)}")
            raise