import asyncio
import logging
import os
import time

from core.database import db_manager
from sqlalchemy import text

logger = logging.getLogger(__name__)

# Track initialization state to prevent redundant retries
_db_initialized = False


async def check_database_health() -> bool:
    """Check if database is healthy"""
    start_time = time.time()
    logger.debug("[DB_OP] Starting database health check")
    try:
        if not db_manager.async_session_maker:
            return False

        async with db_manager.async_session_maker() as session:
            await session.execute(text("SELECT 1"))
            logger.debug(f"[DB_OP] Database health check completed in {time.time() - start_time:.4f}s - healthy: True")
            return True
    except Exception as e:
        logger.error(f"Database health check failed: {e}")
        logger.debug(f"[DB_OP] Database health check failed in {time.time() - start_time:.4f}s - healthy: False")
        return False


async def initialize_database():
    """Initialize database and create tables with retry logic for deployment resilience."""
    global _db_initialized

    if _db_initialized:
        logger.info("Database already initialized, skipping")
        return

    if "MGX_IGNORE_INIT_DB" in os.environ:
        logger.info("Ignore creating tables")
        return

    start_time = time.time()
    logger.debug("[DB_OP] Starting database initialization")

    max_retries = 3
    retry_delay = 2  # seconds

    for attempt in range(1, max_retries + 1):
        try:
            logger.info(f"🔧 Starting database initialization (attempt {attempt}/{max_retries})...")
            await db_manager.init_db()
            logger.info("🔧 Database connection initialized, now creating tables if tables not exist...")
            await db_manager.create_tables()
            logger.info("🔧 Table creation completed")
            logger.info("Database initialized successfully")
            logger.debug(f"[DB_OP] Database initialization completed in {time.time() - start_time:.4f}s")
            _db_initialized = True
            return
        except Exception as e:
            logger.error(f"Failed to initialize database (attempt {attempt}/{max_retries}): {e}")
            if attempt < max_retries:
                logger.info(f"Retrying in {retry_delay}s...")
                await asyncio.sleep(retry_delay)
                retry_delay *= 2  # Exponential backoff
                # Reset engine for retry
                try:
                    await db_manager.close_db()
                except Exception:
                    pass
            else:
                logger.error(f"Database initialization failed after {max_retries} attempts")
                raise


async def close_database():
    """Close database connections"""
    start_time = time.time()
    logger.debug("[DB_OP] Starting database close")
    try:
        await db_manager.close_db()
        logger.info("Database connections closed")
        logger.debug(f"[DB_OP] Database close completed in {time.time() - start_time:.4f}s")
    except Exception as e:
        logger.error(f"Error closing database: {e}")
        logger.debug(f"[DB_OP] Database close failed in {time.time() - start_time:.4f}s")
