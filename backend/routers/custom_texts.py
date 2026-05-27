import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.custom_texts import Custom_textsService

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/custom_texts", tags=["custom_texts"])


# ---------- Pydantic Schemas ----------
class Custom_textsData(BaseModel):
    """Entity data schema (for create/update)"""
    text_key: str
    text_value: str
    updated_by: str = None
    updated_at: Optional[datetime] = None


class Custom_textsUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    text_key: Optional[str] = None
    text_value: Optional[str] = None
    updated_by: Optional[str] = None
    updated_at: Optional[datetime] = None


class Custom_textsResponse(BaseModel):
    """Entity response schema"""
    id: int
    text_key: str
    text_value: str
    updated_by: Optional[str] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class Custom_textsListResponse(BaseModel):
    """List response schema"""
    items: List[Custom_textsResponse]
    total: int
    skip: int
    limit: int


class Custom_textsBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[Custom_textsData]


class Custom_textsBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: Custom_textsUpdateData


class Custom_textsBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[Custom_textsBatchUpdateItem]


class Custom_textsBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=Custom_textsListResponse)
async def query_custom_textss(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Query custom_textss with filtering, sorting, and pagination"""
    logger.debug(f"Querying custom_textss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = Custom_textsService(db)
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
        logger.debug(f"Found {result['total']} custom_textss")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying custom_textss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=Custom_textsListResponse)
async def query_custom_textss_all(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query custom_textss with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying custom_textss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = Custom_textsService(db)
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
        logger.debug(f"Found {result['total']} custom_textss")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying custom_textss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=Custom_textsResponse)
async def get_custom_texts(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Get a single custom_texts by ID"""
    logger.debug(f"Fetching custom_texts with id: {id}, fields={fields}")
    
    service = Custom_textsService(db)
    try:
        result = await service.get_by_id(id)
        if not result:
            logger.warning(f"Custom_texts with id {id} not found")
            raise HTTPException(status_code=404, detail="Custom_texts not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching custom_texts {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=Custom_textsResponse, status_code=201)
async def create_custom_texts(
    data: Custom_textsData,
    db: AsyncSession = Depends(get_db),
):
    """Create a new custom_texts"""
    logger.debug(f"Creating new custom_texts with data: {data}")
    
    service = Custom_textsService(db)
    try:
        result = await service.create(data.model_dump())
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create custom_texts")
        
        logger.info(f"Custom_texts created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating custom_texts: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating custom_texts: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[Custom_textsResponse], status_code=201)
async def create_custom_textss_batch(
    request: Custom_textsBatchCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create multiple custom_textss in a single request"""
    logger.debug(f"Batch creating {len(request.items)} custom_textss")
    
    service = Custom_textsService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump())
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} custom_textss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[Custom_textsResponse])
async def update_custom_textss_batch(
    request: Custom_textsBatchUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update multiple custom_textss in a single request"""
    logger.debug(f"Batch updating {len(request.items)} custom_textss")
    
    service = Custom_textsService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict)
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} custom_textss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=Custom_textsResponse)
async def update_custom_texts(
    id: int,
    data: Custom_textsUpdateData,
    db: AsyncSession = Depends(get_db),
):
    """Update an existing custom_texts"""
    logger.debug(f"Updating custom_texts {id} with data: {data}")

    service = Custom_textsService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict)
        if not result:
            logger.warning(f"Custom_texts with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Custom_texts not found")
        
        logger.info(f"Custom_texts {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating custom_texts {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating custom_texts {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_custom_textss_batch(
    request: Custom_textsBatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple custom_textss by their IDs"""
    logger.debug(f"Batch deleting {len(request.ids)} custom_textss")
    
    service = Custom_textsService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id)
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} custom_textss successfully")
        return {"message": f"Successfully deleted {deleted_count} custom_textss", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_custom_texts(
    id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a single custom_texts by ID"""
    logger.debug(f"Deleting custom_texts with id: {id}")
    
    service = Custom_textsService(db)
    try:
        success = await service.delete(id)
        if not success:
            logger.warning(f"Custom_texts with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Custom_texts not found")
        
        logger.info(f"Custom_texts {id} deleted successfully")
        return {"message": "Custom_texts deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting custom_texts {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")