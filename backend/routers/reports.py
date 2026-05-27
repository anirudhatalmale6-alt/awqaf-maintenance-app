import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.reports import ReportsService

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/reports", tags=["reports"])


# ---------- Pydantic Schemas ----------
class ReportsData(BaseModel):
    """Entity data schema (for create/update)"""
    user_id: str
    title: str
    description: str
    category: str
    priority: str
    status: str
    reporter_name: str = None
    reporter_phone: str = None
    reporter_role: str = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ReportsUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    user_id: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    reporter_name: Optional[str] = None
    reporter_phone: Optional[str] = None
    reporter_role: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ReportsResponse(BaseModel):
    """Entity response schema"""
    id: int
    user_id: str
    title: str
    description: str
    category: str
    priority: str
    status: str
    reporter_name: Optional[str] = None
    reporter_phone: Optional[str] = None
    reporter_role: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ReportsListResponse(BaseModel):
    """List response schema"""
    items: List[ReportsResponse]
    total: int
    skip: int
    limit: int


class ReportsBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[ReportsData]


class ReportsBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: ReportsUpdateData


class ReportsBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[ReportsBatchUpdateItem]


class ReportsBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=ReportsListResponse)
async def query_reportss(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Query reportss with filtering, sorting, and pagination"""
    logger.debug(f"Querying reportss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = ReportsService(db)
    try:
        # Parse query JSON if provided
        query_dict = None
        if query:
            try:
                query_dict = json.loads(query)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid query JSON format")
        
        result = await service.get_list(
            skip=skip, 
            limit=limit,
            query_dict=query_dict,
            sort=sort,
        )
        logger.debug(f"Found {result['total']} reportss")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying reportss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=ReportsListResponse)
async def query_reportss_all(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query reportss with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying reportss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = ReportsService(db)
    try:
        # Parse query JSON if provided
        query_dict = None
        if query:
            try:
                query_dict = json.loads(query)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid query JSON format")

        result = await service.get_list(
            skip=skip,
            limit=limit,
            query_dict=query_dict,
            sort=sort
        )
        logger.debug(f"Found {result['total']} reportss")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying reportss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=ReportsResponse)
async def get_reports(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Get a single reports by ID"""
    logger.debug(f"Fetching reports with id: {id}, fields={fields}")
    
    service = ReportsService(db)
    try:
        result = await service.get_by_id(id)
        if not result:
            logger.warning(f"Reports with id {id} not found")
            raise HTTPException(status_code=404, detail="Reports not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching reports {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=ReportsResponse, status_code=201)
async def create_reports(
    data: ReportsData,
    db: AsyncSession = Depends(get_db),
):
    """Create a new reports"""
    logger.debug(f"Creating new reports with data: {data}")
    
    service = ReportsService(db)
    try:
        result = await service.create(data.model_dump())
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create reports")
        
        logger.info(f"Reports created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating reports: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating reports: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[ReportsResponse], status_code=201)
async def create_reportss_batch(
    request: ReportsBatchCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create multiple reportss in a single request"""
    logger.debug(f"Batch creating {len(request.items)} reportss")
    
    service = ReportsService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump())
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} reportss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[ReportsResponse])
async def update_reportss_batch(
    request: ReportsBatchUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update multiple reportss in a single request"""
    logger.debug(f"Batch updating {len(request.items)} reportss")
    
    service = ReportsService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict)
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} reportss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=ReportsResponse)
async def update_reports(
    id: int,
    data: ReportsUpdateData,
    db: AsyncSession = Depends(get_db),
):
    """Update an existing reports"""
    logger.debug(f"Updating reports {id} with data: {data}")

    service = ReportsService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict)
        if not result:
            logger.warning(f"Reports with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Reports not found")
        
        logger.info(f"Reports {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating reports {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating reports {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_reportss_batch(
    request: ReportsBatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple reportss by their IDs"""
    logger.debug(f"Batch deleting {len(request.ids)} reportss")
    
    service = ReportsService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id)
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} reportss successfully")
        return {"message": f"Successfully deleted {deleted_count} reportss", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_reports(
    id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a single reports by ID"""
    logger.debug(f"Deleting reports with id: {id}")
    
    service = ReportsService(db)
    try:
        success = await service.delete(id)
        if not success:
            logger.warning(f"Reports with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Reports not found")
        
        logger.info(f"Reports {id} deleted successfully")
        return {"message": "Reports deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting reports {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")