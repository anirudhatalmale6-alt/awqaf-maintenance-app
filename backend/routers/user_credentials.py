import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.user_credentials import User_credentialsService

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/user_credentials", tags=["user_credentials"])


# ---------- Pydantic Schemas ----------
class User_credentialsData(BaseModel):
    """Entity data schema (for create/update)"""
    user_id: str
    username: str
    password_hash: str
    recovery_email: str = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class User_credentialsUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    user_id: Optional[str] = None
    username: Optional[str] = None
    password_hash: Optional[str] = None
    recovery_email: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class User_credentialsResponse(BaseModel):
    """Entity response schema"""
    id: int
    user_id: str
    username: str
    password_hash: str
    recovery_email: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class User_credentialsListResponse(BaseModel):
    """List response schema"""
    items: List[User_credentialsResponse]
    total: int
    skip: int
    limit: int


class User_credentialsBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[User_credentialsData]


class User_credentialsBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: User_credentialsUpdateData


class User_credentialsBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[User_credentialsBatchUpdateItem]


class User_credentialsBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=User_credentialsListResponse)
async def query_user_credentialss(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Query user_credentialss with filtering, sorting, and pagination"""
    logger.debug(f"Querying user_credentialss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = User_credentialsService(db)
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
        logger.debug(f"Found {result['total']} user_credentialss")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying user_credentialss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=User_credentialsListResponse)
async def query_user_credentialss_all(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query user_credentialss with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying user_credentialss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = User_credentialsService(db)
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
        logger.debug(f"Found {result['total']} user_credentialss")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying user_credentialss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=User_credentialsResponse)
async def get_user_credentials(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Get a single user_credentials by ID"""
    logger.debug(f"Fetching user_credentials with id: {id}, fields={fields}")
    
    service = User_credentialsService(db)
    try:
        result = await service.get_by_id(id)
        if not result:
            logger.warning(f"User_credentials with id {id} not found")
            raise HTTPException(status_code=404, detail="User_credentials not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching user_credentials {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=User_credentialsResponse, status_code=201)
async def create_user_credentials(
    data: User_credentialsData,
    db: AsyncSession = Depends(get_db),
):
    """Create a new user_credentials"""
    logger.debug(f"Creating new user_credentials with data: {data}")
    
    service = User_credentialsService(db)
    try:
        result = await service.create(data.model_dump())
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create user_credentials")
        
        logger.info(f"User_credentials created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating user_credentials: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating user_credentials: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[User_credentialsResponse], status_code=201)
async def create_user_credentialss_batch(
    request: User_credentialsBatchCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create multiple user_credentialss in a single request"""
    logger.debug(f"Batch creating {len(request.items)} user_credentialss")
    
    service = User_credentialsService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump())
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} user_credentialss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[User_credentialsResponse])
async def update_user_credentialss_batch(
    request: User_credentialsBatchUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update multiple user_credentialss in a single request"""
    logger.debug(f"Batch updating {len(request.items)} user_credentialss")
    
    service = User_credentialsService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict)
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} user_credentialss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=User_credentialsResponse)
async def update_user_credentials(
    id: int,
    data: User_credentialsUpdateData,
    db: AsyncSession = Depends(get_db),
):
    """Update an existing user_credentials"""
    logger.debug(f"Updating user_credentials {id} with data: {data}")

    service = User_credentialsService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict)
        if not result:
            logger.warning(f"User_credentials with id {id} not found for update")
            raise HTTPException(status_code=404, detail="User_credentials not found")
        
        logger.info(f"User_credentials {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating user_credentials {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating user_credentials {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_user_credentialss_batch(
    request: User_credentialsBatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple user_credentialss by their IDs"""
    logger.debug(f"Batch deleting {len(request.ids)} user_credentialss")
    
    service = User_credentialsService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id)
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} user_credentialss successfully")
        return {"message": f"Successfully deleted {deleted_count} user_credentialss", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_user_credentials(
    id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a single user_credentials by ID"""
    logger.debug(f"Deleting user_credentials with id: {id}")
    
    service = User_credentialsService(db)
    try:
        success = await service.delete(id)
        if not success:
            logger.warning(f"User_credentials with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="User_credentials not found")
        
        logger.info(f"User_credentials {id} deleted successfully")
        return {"message": "User_credentials deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting user_credentials {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")