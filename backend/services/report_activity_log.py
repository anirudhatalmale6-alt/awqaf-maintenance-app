import logging
from typing import Optional, Dict, Any, List

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from models.report_activity_log import Report_activity_log

logger = logging.getLogger(__name__)


# ------------------ Service Layer ------------------
class Report_activity_logService:
    """Service layer for Report_activity_log operations"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, data: Dict[str, Any]) -> Optional[Report_activity_log]:
        """Create a new report_activity_log"""
        try:
            obj = Report_activity_log(**data)
            self.db.add(obj)
            await self.db.commit()
            await self.db.refresh(obj)
            logger.info(f"Created report_activity_log with id: {obj.id}")
            return obj
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error creating report_activity_log: {str(e)}")
            raise

    async def get_by_id(self, obj_id: int) -> Optional[Report_activity_log]:
        """Get report_activity_log by ID"""
        try:
            query = select(Report_activity_log).where(Report_activity_log.id == obj_id)
            result = await self.db.execute(query)
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching report_activity_log {obj_id}: {str(e)}")
            raise

    async def get_list(
        self, 
        skip: int = 0, 
        limit: int = 20, 
        query_dict: Optional[Dict[str, Any]] = None,
        sort: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get paginated list of report_activity_logs"""
        try:
            query = select(Report_activity_log)
            count_query = select(func.count(Report_activity_log.id))
            
            if query_dict:
                for field, value in query_dict.items():
                    if hasattr(Report_activity_log, field):
                        query = query.where(getattr(Report_activity_log, field) == value)
                        count_query = count_query.where(getattr(Report_activity_log, field) == value)
            
            count_result = await self.db.execute(count_query)
            total = count_result.scalar()

            if sort:
                if sort.startswith('-'):
                    field_name = sort[1:]
                    if hasattr(Report_activity_log, field_name):
                        query = query.order_by(getattr(Report_activity_log, field_name).desc())
                else:
                    if hasattr(Report_activity_log, sort):
                        query = query.order_by(getattr(Report_activity_log, sort))
            else:
                query = query.order_by(Report_activity_log.id.desc())

            result = await self.db.execute(query.offset(skip).limit(limit))
            items = result.scalars().all()

            return {
                "items": items,
                "total": total,
                "skip": skip,
                "limit": limit,
            }
        except Exception as e:
            logger.error(f"Error fetching report_activity_log list: {str(e)}")
            raise

    async def update(self, obj_id: int, update_data: Dict[str, Any]) -> Optional[Report_activity_log]:
        """Update report_activity_log"""
        try:
            obj = await self.get_by_id(obj_id)
            if not obj:
                logger.warning(f"Report_activity_log {obj_id} not found for update")
                return None
            for key, value in update_data.items():
                if hasattr(obj, key):
                    setattr(obj, key, value)

            await self.db.commit()
            await self.db.refresh(obj)
            logger.info(f"Updated report_activity_log {obj_id}")
            return obj
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error updating report_activity_log {obj_id}: {str(e)}")
            raise

    async def delete(self, obj_id: int) -> bool:
        """Delete report_activity_log"""
        try:
            obj = await self.get_by_id(obj_id)
            if not obj:
                logger.warning(f"Report_activity_log {obj_id} not found for deletion")
                return False
            await self.db.delete(obj)
            await self.db.commit()
            logger.info(f"Deleted report_activity_log {obj_id}")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error deleting report_activity_log {obj_id}: {str(e)}")
            raise

    async def get_by_field(self, field_name: str, field_value: Any) -> Optional[Report_activity_log]:
        """Get report_activity_log by any field"""
        try:
            if not hasattr(Report_activity_log, field_name):
                raise ValueError(f"Field {field_name} does not exist on Report_activity_log")
            result = await self.db.execute(
                select(Report_activity_log).where(getattr(Report_activity_log, field_name) == field_value)
            )
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching report_activity_log by {field_name}: {str(e)}")
            raise

    async def list_by_field(
        self, field_name: str, field_value: Any, skip: int = 0, limit: int = 20
    ) -> List[Report_activity_log]:
        """Get list of report_activity_logs filtered by field"""
        try:
            if not hasattr(Report_activity_log, field_name):
                raise ValueError(f"Field {field_name} does not exist on Report_activity_log")
            result = await self.db.execute(
                select(Report_activity_log)
                .where(getattr(Report_activity_log, field_name) == field_value)
                .offset(skip)
                .limit(limit)
                .order_by(Report_activity_log.id.desc())
            )
            return result.scalars().all()
        except Exception as e:
            logger.error(f"Error fetching report_activity_logs by {field_name}: {str(e)}")
            raise