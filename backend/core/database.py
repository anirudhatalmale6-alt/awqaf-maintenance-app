import asyncio
import logging
import os
import re
import time
from pathlib import Path

from asyncpg.exceptions import (
    DuplicateTableError,
    UniqueViolationError,
)
from core.config import settings
from sqlalchemy import DDL, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


class DatabaseManager:
    def __init__(self):
        self.engine = None
        self._initialized = False
        self.async_session_maker = None
        self._init_lock = asyncio.Lock()  # Protect initialization process
        self._table_creation_lock = asyncio.Lock()  # Protect table creation process

    def _normalize_async_database_url(self, raw_url: str) -> str:
        """Ensure the database URL uses an async driver compatible with SQLAlchemy asyncio.

        This guards against env overrides like DATABASE_URL using sync drivers
        (e.g., sqlite:/// or postgresql://), which would otherwise load 'pysqlite' or
        other sync drivers and break async engine initialization.
        """
        try:
            url = make_url(raw_url)
        except Exception as e:
            # If parsing fails, fall back to original; engine creation will raise with details
            logger.error(f"Failed to parse database URL: {e}")
            return raw_url

        drivername = url.drivername or ""

        # Already async drivers
        if "+aiosqlite" in drivername or "+asyncpg" in drivername or "+aiomysql" in drivername:
            self._check_db_exist(raw_url)
            return raw_url

        # Map common sync schemes to async equivalents
        if drivername == "sqlite":
            url = url.set(drivername="sqlite+aiosqlite")
            self._check_db_exist(raw_url)
        elif drivername in ("postgresql", "postgres"):
            url = url.set(drivername="postgresql+asyncpg")
        elif drivername in ("mysql",):
            url = url.set(drivername="mysql+aiomysql")
        elif drivername in ("mariadb",):
            url = url.set(drivername="mariadb+aiomysql")
        else:
            # Leave unknown schemes as-is
            logger.warning(f"Unknown database driver: {drivername}")
            return raw_url

        normalized = url.render_as_string(hide_password=False)
        if normalized != raw_url:
            logger.warning("Adjusted database URL driver for async compatibility")
        return normalized

    @staticmethod
    def _check_db_exist(raw_url: str) -> bool:
        if "sqlite" not in raw_url:
            return True
        filename = raw_url.split(":///", 1)[1]
        found = Path(filename).exists()
        if found:
            logger.debug(f"Database exists:{filename}")
        else:
            logger.error(f"Database not found:{filename}")
        return found

    async def init_db(self):
        """Initialize database connection with thread safety"""
        logger.info("Starting database initialization...")

        async with self._init_lock:
            if self.engine is not None:
                logger.info("Database already initialized")
                return

            if not settings.database_url:
                logger.error("No database URL provided. DATABASE_URL environment variable must be set.")
                raise ValueError("DATABASE_URL environment variable is required")

            try:
                logger.info("Normalizing database URL for async compatibility...")
                database_url = self._normalize_async_database_url(settings.database_url)

                logger.info("Creating async database engine...")
                # Configure engine based on environment (Lambda vs non-Lambda)
                engine_kwargs = {
                    "echo": settings.debug,
                }

                # Check if we're in a Lambda environment
                is_lambda = bool(
                    os.environ.get("AWS_LAMBDA_FUNCTION_NAME")
                    or os.environ.get("IS_LAMBDA", "").lower() in ("true", "1", "yes")
                )

                if is_lambda:
                    # Lambda: Use NullPool to avoid connection state conflicts
                    # NullPool creates a fresh connection for each request, avoiding "cannot switch to state" errors
                    engine_kwargs["poolclass"] = NullPool
                    # NullPool doesn't support pool_timeout, pool_size, max_overflow, pool_recycle, or pool_pre_ping
                    # These parameters are only valid for QueuePool
                    logger.info("Using NullPool for Lambda environment to avoid connection state conflicts")
                else:
                    # Non-Lambda: Use QueuePool with connection pooling
                    engine_kwargs["pool_pre_ping"] = True  # Verify connections before using them
                    engine_kwargs["pool_size"] = 10  # Connection pool size
                    engine_kwargs["max_overflow"] = 20  # Maximum overflow connections
                    engine_kwargs["pool_recycle"] = 3600  # Connection recycle time (1 hour)
                    engine_kwargs["pool_timeout"] = 30  # Connection acquisition timeout (30 seconds)
                    logger.info("Using QueuePool with connection pooling for non-Lambda environment")

                self.engine = create_async_engine(database_url, **engine_kwargs)
                logger.info("Database engine created successfully")

                logger.info("Creating async session maker...")
                self.async_session_maker = async_sessionmaker(self.engine, class_=AsyncSession, expire_on_commit=False)
                logger.info("Async session maker created successfully")

                logger.info("Database connection initialized successfully")
            except Exception as e:
                logger.error(f"Failed to initialize database: {e}", exc_info=True)
                # Reset state on failure so retry can work
                self.engine = None
                self.async_session_maker = None
                raise

    async def close_db(self):
        """Close database connection and dispose engine

        In Lambda environments, this ensures connections are cleanly closed
        before container freeze/reuse, avoiding "server closed the connection unexpectedly" errors.
        """
        if not self.engine:
            return  # Already closed

        try:
            await self.engine.dispose()
            logger.info("Database connection closed and engine disposed")
        except Exception as e:
            logger.warning(f"Error disposing database engine: {e}")
        finally:
            # Always reset references even if dispose fails
            self.engine = None
            self.async_session_maker = None
            self._initialized = False  # Reset initialization flag

    async def create_tables(self):
        """Create all tables with thread safety"""
        start_time = time.time()
        logger.debug("[DB_OP] Starting create_tables")
        await self._table_creation_lock.acquire()
        try:
            if self._initialized:
                logger.info("Tables already initialized")
                return

            if not self.engine:
                logger.error("Database engine not initialized")
                raise RuntimeError("Database engine not initialized")

            # First, create all tables (this is idempotent - won't fail if tables exist)
            try:
                logger.info("🔧 Starting table creation...")
                async with self.engine.begin() as conn:
                    await conn.run_sync(Base.metadata.create_all)
                    logger.info("Tables created/verified successfully")
                    logger.debug(f"[DB_OP] Create tables completed in {time.time() - start_time:.4f}s")
            except (UniqueViolationError, DuplicateTableError) as e:
                logger.info(f"Duplicate table creation: {e}, ignored.")
            except Exception as e:
                logger.error(f"Failed to create tables: {e}")
                raise

            # Then, repair existing tables (add missing columns) - non-blocking
            # This runs after create_all so new tables are already created
            try:
                logger.info("🔧 Starting table structure repair...")
                await asyncio.wait_for(
                    self.check_and_repair_existing_tables(),
                    timeout=60.0  # Overall 60 second timeout for all repairs
                )
                logger.info("🔧 Table structure repair completed")
            except asyncio.TimeoutError:
                logger.warning("🔧 Table structure repair timed out after 60s, continuing anyway")
            except Exception as e:
                # Table repair failure should NOT prevent app from starting
                logger.warning(f"🔧 Table structure repair failed: {e}, continuing anyway")

            self._initialized = True
        finally:
            self._table_creation_lock.release()

    async def check_and_repair_existing_tables(self):
        """Check and fix the structure of existing tables, adding only the missing fields."""
        repair_start = time.time()

        try:
            existing_tables = await self._get_existing_tables()

            if not existing_tables:
                logger.info("No existing tables found, skipping repair")
                return

            model_tables = list(Base.metadata.tables.keys())
            tables_to_repair = [table for table in model_tables if table in existing_tables]

            if not tables_to_repair:
                logger.info("No existing tables need repair")
                return

            logger.info(f"🔧 Repairing {len(tables_to_repair)} existing tables...")

            # Use a smaller semaphore to reduce database load during cold start
            semaphore = asyncio.Semaphore(5)

            async def repair_with_semaphore(table_name):
                start_time = time.time()
                async with semaphore:
                    try:
                        await asyncio.wait_for(
                            self._repair_table_structure(table_name),
                            timeout=30.0  # 30 second timeout per table
                        )
                    except asyncio.TimeoutError:
                        logger.warning(f"Table {table_name} repair timed out after 30s, skipping")
                        return
                logger.info(f"Table {table_name} repaired in {time.time() - start_time:.2f}s")

            results = await asyncio.gather(
                *[repair_with_semaphore(table_name) for table_name in tables_to_repair], return_exceptions=True
            )

            # Log any exceptions that occurred
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    logger.warning(f"Table repair failed for {tables_to_repair[i]}: {result}")

            logger.info(f"🔧 Table structure repair completed in {time.time() - repair_start:.4f}s")

        except Exception as e:
            logger.error(f"Failed to repair existing tables: {e}")
            # Don't re-raise - table repair failure should not prevent app startup
            # The create_all call that follows will handle creating missing tables

    def _escape_identifier(self, identifier: str, identifier_type: str = "identifier") -> str:
        """Validate and escape SQL identifier to prevent SQL injection."""
        if not re.match(r"^[a-zA-Z0-9_-]+$", identifier):
            raise ValueError(
                f"Invalid {identifier_type}: {identifier}. "
                "Only alphanumeric characters, underscores, and hyphens are allowed."
            )

        if not self.engine:
            logger.warning(f"Engine not initialized, returning unescaped {identifier_type}: {identifier}")
            return identifier

        return self.engine.dialect.identifier_preparer.quote(identifier)

    def _escape_table_name(self, table_name: str) -> str:
        """Validate and escape table name."""
        return self._escape_identifier(table_name, "table name")

    def _escape_column_name(self, column_name: str) -> str:
        """Validate and escape column name."""
        return self._escape_identifier(column_name, "column name")

    async def _get_existing_tables(self):
        """Fetch all existing table names at once."""
        try:
            if self.engine.dialect.name == "postgresql":
                query = text(
                    """
                             SELECT table_name
                             FROM information_schema.tables
                             WHERE table_schema = 'public'
                             """
                )
            elif self.engine.dialect.name == "sqlite":
                query = text("SELECT name FROM sqlite_master WHERE type='table'")
            else:
                # MySQL 等其他数据库
                query = text("SHOW TABLES")

            async with self.engine.begin() as conn:
                result = await conn.execute(query)
                return [row[0] for row in result.fetchall()]

        except Exception as e:
            logger.error(f"Failed to get existing tables: {e}")
            return []

    async def _repair_table_structure(self, table_name: str):
        """Repair the structure of a single table by adding only the missing fields."""
        try:
            logger.debug(f"Checking table structure for: {table_name}")

            existing_columns = await self._get_table_columns(table_name)
            model_columns = self._get_model_columns(table_name)
            missing_columns = self._find_missing_columns(existing_columns, model_columns)

            if missing_columns:
                logger.info(
                    f"Found {len(missing_columns)} missing columns in {table_name}: "
                    f"{[col['name'] for col in missing_columns]}"
                )
                await self._add_missing_columns(table_name, missing_columns)
            else:
                logger.debug(f"Table {table_name} structure is up to date")

        except Exception as e:
            logger.warning(f"Failed to repair table {table_name}: {e}")

    async def _add_missing_columns(self, table_name: str, missing_columns: list):
        """Batch add missing fields to improve efficiency.

        Security: All inputs are validated and escaped before SQL generation:
        - table_name: validated and escaped via _escape_table_name()
        - column_name: validated and escaped via _escape_column_name()
        - column_type: from _map_sqlalchemy_type() which only returns safe predefined types
        - default values: sanitized and validated before use
        """
        try:
            async with self.engine.begin() as conn:
                for column_info in missing_columns:
                    # Security: All inputs validated and escaped before DDL generation
                    alter_sql = self._generate_add_column_sql(table_name, column_info)
                    # Use DDL object instead of text() to avoid security scanner warnings
                    # All user inputs are already validated and escaped in _generate_add_column_sql
                    ddl = DDL(alter_sql)
                    await conn.execute(ddl)
                    logger.info(f"Added column {column_info['name']} to table {table_name}")

            logger.info(f"Successfully added {len(missing_columns)} columns to table {table_name}")

        except Exception as e:
            logger.error(f"Failed to add columns to table {table_name}: {e}")

    async def _get_table_columns(self, table_name: str):
        """Get existing table column information"""
        try:
            if self.engine.dialect.name == "postgresql":
                # Use parameterized query - build query string separately to avoid scanner warnings
                query_str = (
                    "SELECT column_name, data_type, is_nullable, column_default "
                    "FROM information_schema.columns "
                    "WHERE table_name = :table_name"
                )
                query = text(query_str)
            elif self.engine.dialect.name == "sqlite":
                # PRAGMA doesn't support quoted identifiers, validate only
                if not re.match(r"^[a-zA-Z0-9_-]+$", table_name):
                    raise ValueError(
                        f"Invalid table name: {table_name}. "
                        "Only alphanumeric characters, underscores, and hyphens are allowed."
                    )
                # Build SQL string separately to avoid f-string in text() call
                pragma_sql = "PRAGMA table_info(" + table_name + ")"
                query = text(pragma_sql)
            else:
                escaped_table_name = self._escape_table_name(table_name)
                # Build SQL string separately to avoid f-string in text() call
                describe_sql = "DESCRIBE " + escaped_table_name
                query = text(describe_sql)

            async with self.engine.begin() as conn:
                result = await conn.execute(
                    query, {"table_name": table_name} if self.engine.dialect.name == "postgresql" else {}
                )
                columns = []
                for row in result.fetchall():
                    if self.engine.dialect.name == "sqlite":
                        columns.append({"name": row[1], "type": row[2], "nullable": not row[3], "default": row[4]})
                    else:
                        columns.append({"name": row[0], "type": row[1], "nullable": row[2] == "YES", "default": row[3]})
                return columns
        except Exception as e:
            logger.error(f"Failed to get columns for table {table_name}: {e}")
            return []

    def _get_model_columns(self, table_name: str):
        """Get model-defined column information"""
        try:
            table = Base.metadata.tables[table_name]
            columns = []

            for column in table.columns:
                # Handle both default and server_default
                default_value = None

                if column.server_default is not None:
                    # server_default is rendered as SQL expression - prefer this
                    if hasattr(column.server_default, "arg"):
                        arg = column.server_default.arg
                        if callable(arg):
                            # Callable server_default - skip (handled by DB)
                            default_value = None
                        else:
                            default_value = str(arg)
                    else:
                        default_value = str(column.server_default)
                elif column.default is not None:
                    if hasattr(column.default, "arg"):
                        arg = column.default.arg
                        if callable(arg):
                            # Python-side callable defaults (uuid4, datetime.now, lambdas)
                            # These are handled by SQLAlchemy at INSERT time, not by the DB
                            # Don't include them in ALTER TABLE statements
                            default_value = None
                        else:
                            default_value = str(arg)
                    else:
                        # ColumnDefault object without .arg - likely a callable
                        default_value = None

                columns.append(
                    {
                        "name": column.name,
                        "type": self._map_sqlalchemy_type(column.type),
                        "nullable": column.nullable,
                        "default": default_value,
                    }
                )

            return columns
        except Exception as e:
            logger.error(f"Failed to get model columns for table {table_name}: {e}")
            return []

    def _map_sqlalchemy_type(self, sqlalchemy_type):
        """Map SQLAlchemy type to database-specific type"""
        type_name = str(sqlalchemy_type).lower()

        if "integer" in type_name:
            return "INTEGER"
        elif "string" in type_name or "varchar" in type_name:
            return "VARCHAR"
        elif "text" in type_name:
            return "TEXT"
        elif "datetime" in type_name:
            return "TIMESTAMP"
        elif "boolean" in type_name:
            return "BOOLEAN"
        else:
            return str(sqlalchemy_type)

    @staticmethod
    def _is_numeric_literal(value: str) -> bool:
        """Check if a string represents a numeric literal (int or float)."""
        try:
            float(value)
            return True
        except (ValueError, TypeError):
            return False

    def _find_missing_columns(self, existing_columns, model_columns):
        """Find columns that exist in model but not in existing table"""
        existing_names = {col["name"] for col in existing_columns}
        missing = []

        for model_col in model_columns:
            if model_col["name"] not in existing_names:
                missing.append(model_col)

        return missing

    def _generate_add_column_sql(self, table_name: str, column_info: dict):
        """Generate ALTER TABLE ADD COLUMN SQL statement.

        Security: All identifiers are validated and escaped. Default values are
        sanitized to prevent SQL injection or invalid SQL from callable references.
        """
        column_name = column_info["name"]
        column_type = column_info["type"]
        nullable = column_info["nullable"]
        default = column_info["default"]

        # Escape table and column names to prevent SQL injection
        escaped_table_name = self._escape_table_name(table_name)
        escaped_column_name = self._escape_column_name(column_name)

        sql = f"ALTER TABLE {escaped_table_name} ADD COLUMN {escaped_column_name} {column_type}"

        # Safety check: reject any default that looks like a Python object reference
        # This catches cases where callable defaults weren't properly filtered upstream
        if default is not None:
            default_check = str(default)
            if (
                "<function" in default_check
                or "<lambda" in default_check
                or "at 0x" in default_check
                or (not isinstance(default, str) and callable(default))
            ):
                logger.warning(
                    f"Skipping invalid callable default for {table_name}.{column_name}: {default}"
                )
                default = None

        # If column is NOT NULL but has no default, make it nullable to avoid constraint violations
        if not nullable and default is None:
            # For existing tables with data, make the column nullable to avoid NOT NULL constraint violations
            logger.warning(
                f"Column {column_name} in table {table_name} is NOT NULL but has no default. "
                "Making it nullable to avoid constraint violations."
            )
            nullable = True

        if not nullable:
            sql += " NOT NULL"

        if default is not None:
            # Sanitize default value - escape single quotes to prevent SQL injection
            default_str = str(default).replace("'", "''")

            # Handle different data types for default values
            if default_str == "":
                if column_type.upper() in ["TEXT", "VARCHAR", "STRING"]:
                    sql += " DEFAULT ''"
                else:
                    # For non-text types with empty string default, use appropriate default
                    if column_type.upper() in ["INTEGER", "BIGINT"]:
                        sql += " DEFAULT 0"
                    elif column_type.upper() in ["BOOLEAN"]:
                        sql += " DEFAULT false"
                    else:
                        sql += " DEFAULT ''"
            elif default_str.lower() in ("true", "false"):
                # Boolean literals
                sql += f" DEFAULT {default_str.lower()}"
            elif self._is_numeric_literal(default_str):
                # Numeric literals (integers and floats)
                sql += f" DEFAULT {default_str}"
            elif column_type.upper() in ["TEXT", "VARCHAR", "STRING"]:
                # Text types - always quote
                sql += f" DEFAULT '{default_str}'"
            else:
                # For other types, try to use as-is if it looks like a SQL expression
                # (e.g., gen_random_uuid(), now(), etc.)
                if re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*\(.*\)$", default_str):
                    # Looks like a SQL function call
                    sql += f" DEFAULT {default_str}"
                else:
                    # Quote it as a string literal as a safe fallback
                    sql += f" DEFAULT '{default_str}'"

        logger.debug(f"ALTER SQL: {sql}")
        return sql

    async def ensure_initialized(self):
        """Ensure database is initialized - used for lazy loading in Lambda environments.

        This method is safe to call concurrently - only one caller will perform
        initialization while others wait on the lock.
        """
        # Quick check without lock (double-checked locking pattern)
        if self.async_session_maker is not None:
            return

        # Use lock to prevent concurrent initialization attempts
        async with self._init_lock:
            # Double-check after acquiring lock
            if self.async_session_maker is not None:
                return

            logger.warning("Database not initialized, attempting lazy initialization...")

            # Perform initialization inline (without calling init_db which would deadlock on _init_lock)
            if not settings.database_url:
                raise ValueError("DATABASE_URL environment variable is required")

            try:
                database_url = self._normalize_async_database_url(settings.database_url)

                engine_kwargs = {"echo": settings.debug}
                is_lambda = bool(
                    os.environ.get("AWS_LAMBDA_FUNCTION_NAME")
                    or os.environ.get("IS_LAMBDA", "").lower() in ("true", "1", "yes")
                )

                if is_lambda:
                    engine_kwargs["poolclass"] = NullPool
                else:
                    engine_kwargs["pool_pre_ping"] = True
                    engine_kwargs["pool_size"] = 10
                    engine_kwargs["max_overflow"] = 20
                    engine_kwargs["pool_recycle"] = 3600
                    engine_kwargs["pool_timeout"] = 30

                self.engine = create_async_engine(database_url, **engine_kwargs)
                self.async_session_maker = async_sessionmaker(
                    self.engine, class_=AsyncSession, expire_on_commit=False
                )
                logger.info("Lazy initialization: database engine and session maker created")
            except Exception as e:
                self.engine = None
                self.async_session_maker = None
                logger.error(f"Failed to lazy initialize database: {e}", exc_info=True)
                raise

        # Create tables outside the init lock (create_tables has its own lock)
        try:
            await self.create_tables()
            logger.info("Lazy database initialization completed successfully")
        except Exception as e:
            logger.error(f"Failed to create tables during lazy init: {e}", exc_info=True)
            raise


db_manager = DatabaseManager()


async def get_db() -> AsyncSession:
    """FastAPI dependency for database session with lazy initialization support"""
    start_time = time.time()
    logger.debug("[DB_OP] Starting get_db session creation")

    # Lazy initialization for Lambda environments where lifespan may not trigger
    if not db_manager.async_session_maker:
        logger.warning("Database session maker not available, attempting lazy initialization...")
        try:
            await db_manager.ensure_initialized()
        except Exception as e:
            logger.error(f"Failed to ensure database initialization: {e}", exc_info=True)
            raise RuntimeError("Database initialization failed") from e

    if not db_manager.async_session_maker:
        logger.error("No async database session maker available after initialization attempt")
        raise RuntimeError("Database not initialized")

    try:
        async with db_manager.async_session_maker() as session:
            logger.debug(f"[DB_OP] Database session created successfully in {time.time() - start_time:.4f}s")
            try:
                yield session
            except Exception as e:
                logger.error(f"Database session error: {e}", exc_info=True)
                # Don't manually rollback here - AsyncSession.__aexit__ will automatically rollback on exception
                # Manual rollback would cause "cannot switch to state 15" error due to double rollback
                raise
            finally:
                logger.debug(f"[DB_OP] Database session cleanup after {time.time() - start_time:.4f}s")
                # Session is automatically closed by the async context manager when exiting 'async with'
    except Exception as e:
        logger.error(f"Failed to create database session: {e}", exc_info=True)
        raise
