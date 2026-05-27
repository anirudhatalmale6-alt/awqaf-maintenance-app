import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.report_images import Report_imagesService

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/report_images", tags=["report_images"])


# ---------- Pydantic Schemas ----------
class Report_imagesData(BaseModel):
    """Entity data schema (for create/update)"""
    user_id: str = None
    report_id: int
    object_key: str
    file_name: str
    created_at: Optional[datetime] = None


class Report_imagesUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    user_id: Optional[str] = None
    report_id: Optional[int] = None
    object_key: Optional[str] = None
    file_name: Optional[str] = None
    created_at: Optional[datetime] = None


class Report_imagesResponse(BaseModel):
    """Entity response schema"""
    id: int
    user_id: Optional[str] = None
    report_id: int
    object_key: str
    file_name: str
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class Report_imagesListResponse(BaseModel):
    """List response schema"""
    items: List[Report_imagesResponse]
    total: int
    skip: int
    limit: int


class Report_imagesBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[Report_imagesData]


class Report_imagesBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: Report_imagesUpdateData


class Report_imagesBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[Report_imagesBatchUpdateItem]


class Report_imagesBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=Report_imagesListResponse)
async def query_report_imagess(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Query report_imagess with filtering, sorting, and pagination"""
    logger.debug(f"Querying report_imagess: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = Report_imagesService(db)
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
        logger.debug(f"Found {result['total']} report_imagess")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying report_imagess: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=Report_imagesListResponse)
async def query_report_imagess_all(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query report_imagess with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying report_imagess: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = Report_imagesService(db)
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
        logger.debug(f"Found {result['total']} report_imagess")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying report_imagess: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=Report_imagesResponse)
async def get_report_images(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Get a single report_images by ID"""
    logger.debug(f"Fetching report_images with id: {id}, fields={fields}")
    
    service = Report_imagesService(db)
    try:
        result = await service.get_by_id(id)
        if not result:
            logger.warning(f"Report_images with id {id} not found")
            raise HTTPException(status_code=404, detail="Report_images not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching report_images {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=Report_imagesResponse, status_code=201)
async def create_report_images(
    data: Report_imagesData,
    db: AsyncSession = Depends(get_db),
):
    """Create a new report_images"""
    logger.debug(f"Creating new report_images with data: {data}")
    
    service = Report_imagesService(db)
    try:
        result = await service.create(data.model_dump())
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create report_images")
        
        logger.info(f"Report_images created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating report_images: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating report_images: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[Report_imagesResponse], status_code=201)
async def create_report_imagess_batch(
    request: Report_imagesBatchCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create multiple report_imagess in a single request"""
    logger.debug(f"Batch creating {len(request.items)} report_imagess")
    
    service = Report_imagesService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump())
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} report_imagess successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[Report_imagesResponse])
async def update_report_imagess_batch(
    request: Report_imagesBatchUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update multiple report_imagess in a single request"""
    logger.debug(f"Batch updating {len(request.items)} report_imagess")
    
    service = Report_imagesService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict)
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} report_imagess successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=Report_imagesResponse)
async def update_report_images(
    id: int,
    data: Report_imagesUpdateData,
    db: AsyncSession = Depends(get_db),
):
    """Update an existing report_images"""
    logger.debug(f"Updating report_images {id} with data: {data}")

    service = Report_imagesService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict)
        if not result:
            logger.warning(f"Report_images with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Report_images not found")
        
        logger.info(f"Report_images {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating report_images {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating report_images {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_report_imagess_batch(
    request: Report_imagesBatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple report_imagess by their IDs"""
    logger.debug(f"Batch deleting {len(request.ids)} report_imagess")
    
    service = Report_imagesService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id)
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} report_imagess successfully")
        return {"message": f"Successfully deleted {deleted_count} report_imagess", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_report_images(
    id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a single report_images by ID"""
    logger.debug(f"Deleting report_images with id: {id}")
    
    service = Report_imagesService(db)
    try:
        success = await service.delete(id)
        if not success:
            logger.warning(f"Report_images with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Report_images not found")
        
        logger.info(f"Report_images {id} deleted successfully")
        return {"message": "Report_images deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting report_images {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")