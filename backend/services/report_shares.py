import logging
from typing import Optional, Dict, Any, List

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from models.report_shares import Report_shares

logger = logging.getLogger(__name__)


# ------------------ Service Layer ------------------
class Report_sharesService:
    """Service layer for Report_shares operations"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, data: Dict[str, Any]) -> Optional[Report_shares]:
        """Create a new report_shares"""
        try:
            obj = Report_shares(**data)
            self.db.add(obj)
            await self.db.commit()
            await self.db.refresh(obj)
            logger.info(f"Created report_shares with id: {obj.id}")
            return obj
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error creating report_shares: {str(e)}")
            raise

    async def get_by_id(self, obj_id: int) -> Optional[Report_shares]:
        """Get report_shares by ID"""
        try:
            query = select(Report_shares).where(Report_shares.id == obj_id)
            result = await self.db.execute(query)
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching report_shares {obj_id}: {str(e)}")
            raise

    async def get_list(
        self, 
        skip: int = 0, 
        limit: int = 20, 
        query_dict: Optional[Dict[str, Any]] = None,
        sort: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get paginated list of report_sharess"""
        try:
            query = select(Report_shares)
            count_query = select(func.count(Report_shares.id))
            
            if query_dict:
                for field, value in query_dict.items():
                    if hasattr(Report_shares, field):
                        query = query.where(getattr(Report_shares, field) == value)
                        count_query = count_query.where(getattr(Report_shares, field) == value)
            
            count_result = await self.db.execute(count_query)
            total = count_result.scalar()

            if sort:
                if sort.startswith('-'):
                    field_name = sort[1:]
                    if hasattr(Report_shares, field_name):
                        query = query.order_by(getattr(Report_shares, field_name).desc())
                else:
                    if hasattr(Report_shares, sort):
                        query = query.order_by(getattr(Report_shares, sort))
            else:
                query = query.order_by(Report_shares.id.desc())

            result = await self.db.execute(query.offset(skip).limit(limit))
            items = result.scalars().all()

            return {
                "items": items,
                "total": total,
                "skip": skip,
                "limit": limit,
            }
        except Exception as e:
            logger.error(f"Error fetching report_shares list: {str(e)}")
            raise

    async def update(self, obj_id: int, update_data: Dict[str, Any]) -> Optional[Report_shares]:
        """Update report_shares"""
        try:
            obj = await self.get_by_id(obj_id)
            if not obj:
                logger.warning(f"Report_shares {obj_id} not found for update")
                return None
            for key, value in update_data.items():
                if hasattr(obj, key):
                    setattr(obj, key, value)

            await self.db.commit()
            await self.db.refresh(obj)
            logger.info(f"Updated report_shares {obj_id}")
            return obj
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error updating report_shares {obj_id}: {str(e)}")
            raise

    async def delete(self, obj_id: int) -> bool:
        """Delete report_shares"""
        try:
            obj = await self.get_by_id(obj_id)
            if not obj:
                logger.warning(f"Report_shares {obj_id} not found for deletion")
                return False
            await self.db.delete(obj)
            await self.db.commit()
            logger.info(f"Deleted report_shares {obj_id}")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error deleting report_shares {obj_id}: {str(e)}")
            raise

    async def get_by_field(self, field_name: str, field_value: Any) -> Optional[Report_shares]:
        """Get report_shares by any field"""
        try:
            if not hasattr(Report_shares, field_name):
                raise ValueError(f"Field {field_name} does not exist on Report_shares")
            result = await self.db.execute(
                select(Report_shares).where(getattr(Report_shares, field_name) == field_value)
            )
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching report_shares by {field_name}: {str(e)}")
            raise

    async def list_by_field(
        self, field_name: str, field_value: Any, skip: int = 0, limit: int = 20
    ) -> List[Report_shares]:
        """Get list of report_sharess filtered by field"""
        try:
            if not hasattr(Report_shares, field_name):
                raise ValueError(f"Field {field_name} does not exist on Report_shares")
            result = await self.db.execute(
                select(Report_shares)
                .where(getattr(Report_shares, field_name) == field_value)
                .offset(skip)
                .limit(limit)
                .order_by(Report_shares.id.desc())
            )
            return result.scalars().all()
        except Exception as e:
            logger.error(f"Error fetching report_sharess by {field_name}: {str(e)}")
            raise