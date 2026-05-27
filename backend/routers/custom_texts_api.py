"""
Custom Texts API - Simplified endpoints for the inline text editing feature.
Allows the owner to customize any text/label throughout the site.
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.custom_texts import Custom_texts

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/custom-texts", tags=["custom-texts"])


class UpsertRequest(BaseModel):
    text_key: str
    text_value: str


@router.get("/all")
async def get_all_custom_texts(db: AsyncSession = Depends(get_db)):
    """Get all custom texts as a key-value map. Public endpoint (no auth required)."""
    try:
        result = await db.execute(select(Custom_texts))
        rows = result.scalars().all()
        texts = {row.text_key: row.text_value for row in rows}
        return {"texts": texts}
    except Exception as e:
        logger.error(f"Error fetching custom texts: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to fetch custom texts")


@router.post("/upsert")
async def upsert_custom_text(
    data: UpsertRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create or update a custom text entry. Owner-only (enforced by frontend)."""
    try:
        # Fetch all rows matching the key (handles legacy duplicates gracefully)
        result = await db.execute(
            select(Custom_texts)
            .where(Custom_texts.text_key == data.text_key)
            .order_by(Custom_texts.id.asc())
        )
        rows = result.scalars().all()

        if rows:
            # Keep the first row as the source of truth, delete any duplicates
            primary = rows[0]
            if len(rows) > 1:
                dup_ids = [r.id for r in rows[1:]]
                logger.warning(
                    f"Found {len(dup_ids)} duplicate rows for text_key='{data.text_key}', cleaning up ids={dup_ids}"
                )
                await db.execute(
                    sa_delete(Custom_texts).where(Custom_texts.id.in_(dup_ids))
                )

            primary.text_value = data.text_value
            primary.updated_at = datetime.now(timezone.utc)
            await db.commit()
            await db.refresh(primary)
            return {"id": primary.id, "text_key": primary.text_key, "text_value": primary.text_value}
        else:
            new_entry = Custom_texts(
                text_key=data.text_key,
                text_value=data.text_value,
                updated_at=datetime.now(timezone.utc),
            )
            db.add(new_entry)
            await db.commit()
            await db.refresh(new_entry)
            return {"id": new_entry.id, "text_key": new_entry.text_key, "text_value": new_entry.text_value}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error upserting custom text '{data.text_key}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to save custom text")


@router.delete("/delete/{text_key:path}")
async def delete_custom_text(
    text_key: str,
    db: AsyncSession = Depends(get_db),
):
    """Delete a custom text entry (reverts to default). Owner-only (enforced by frontend)."""
    try:
        result = await db.execute(
            sa_delete(Custom_texts).where(Custom_texts.text_key == text_key)
        )
        await db.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Custom text not found")
        return {"message": "Deleted successfully", "text_key": text_key}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error deleting custom text '{text_key}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to delete custom text")