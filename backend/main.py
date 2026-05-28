import asyncio
import importlib
import logging
import os
import pkgutil
import sys
import traceback
from contextlib import asynccontextmanager
from datetime import datetime


# Note: Playwright/Chromium PDF rendering was removed in Task 89.
# All PDF generation now goes through services/pdf_generator.py
# (ReportLab — pure-Python, no native deps, works on AWS Lambda).

# ─── Python 3.13 + Mangum compatibility patch ──────────────────────────────────
# In Python 3.13, asyncio.get_event_loop() raises RuntimeError if no loop exists
# in the current thread (previously it would auto-create one). Older versions of
# Mangum (<=0.19) call get_event_loop() directly, breaking on AWS Lambda Python
# 3.13 runtime. We ensure an event loop exists in the main thread before any
# request handling.
if sys.version_info >= (3, 10):
    try:
        asyncio.get_event_loop()
    except RuntimeError:
        _loop = asyncio.new_event_loop()
        asyncio.set_event_loop(_loop)

from core.config import settings
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.routing import APIRouter

# MODULE_IMPORTS_START
from services.database import initialize_database, close_database
from services.mock_data import initialize_mock_data
from services.auth import initialize_admin_user
from services.seed_owner import initialize_owner_account
from services.seed_locations import initialize_locations
# MODULE_IMPORTS_END


def setup_logging():
    """Configure the logging system.

    Uses a single rotating log file (`logs/app.log`) instead of a fresh
    timestamped file every startup. The previous behavior produced one new
    file per `uvicorn --reload` reload cycle, which on a long-running dev
    box accumulated hundreds of files (e.g. 873 files / 254 MB). That
    bloat in turn poisoned uvicorn's reload watcher: watchfiles enumerates
    every file under the working directory, and a logs/ tree that large
    pushes startup past the platform's 60-second health-check window,
    making the backend appear to "hang" on boot.

    Additionally, on every startup we proactively delete log files older
    than 24 hours so the directory can never silently re-bloat.
    """
    if os.environ.get("IS_LAMBDA") == "true":
        return

    # Create the logs directory
    log_dir = "logs"
    if not os.path.exists(log_dir):
        os.makedirs(log_dir)

    # ── Housekeeping: prune historical bloat on every startup ──────────────
    # Anything older than 24h or any legacy timestamped `app_YYYYMMDD_*.log`
    # file is deleted. This keeps the file count bounded so uvicorn's
    # watchfiles reloader doesn't have to enumerate thousands of entries.
    try:
        import time as _time

        _now = _time.time()
        _cutoff = _now - 24 * 60 * 60  # 24 hours
        for _name in os.listdir(log_dir):
            _path = os.path.join(log_dir, _name)
            if not os.path.isfile(_path):
                continue
            try:
                # Delete legacy per-startup timestamped logs unconditionally
                # (they are never written by the current code), and prune
                # any other log file older than the cutoff.
                if _name.startswith("app_") and _name.endswith(".log"):
                    os.remove(_path)
                    continue
                if os.path.getmtime(_path) < _cutoff:
                    os.remove(_path)
            except OSError:
                pass
    except Exception:  # noqa: BLE001 — never let log housekeeping crash startup
        pass

    # Use a SINGLE rotating log file. Caps total size at ~50 MB
    # (10 MB × 5 backups) so logs/ can never grow without bound.
    log_file = os.path.join(log_dir, "app.log")

    # Configure log format
    log_format = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"

    from logging.handlers import RotatingFileHandler  # local import is fine

    # Reset any handlers that a previous reload cycle may have installed
    # so we don't end up with duplicate log lines after each reload.
    _root = logging.getLogger()
    for _h in list(_root.handlers):
        _root.removeHandler(_h)

    file_handler = RotatingFileHandler(
        log_file, maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8"
    )
    stream_handler = logging.StreamHandler()
    formatter = logging.Formatter(log_format)
    file_handler.setFormatter(formatter)
    stream_handler.setFormatter(formatter)

    logging.basicConfig(
        level=logging.DEBUG,
        format=log_format,
        handlers=[file_handler, stream_handler],
        force=True,
    )

    # Set log levels for specific modules
    logging.getLogger("uvicorn").setLevel(logging.DEBUG)
    logging.getLogger("fastapi").setLevel(logging.DEBUG)

    # Log configuration details
    logger = logging.getLogger(__name__)
    logger.info("=== Logging system initialized ===")
    logger.info(f"Log file: {log_file} (rotating, max 10MB x 5 backups)")
    logger.info("Log level: DEBUG")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger = logging.getLogger(__name__)
    logger.info("=== Application startup initiated ===")

    # MODULE_STARTUP_START
    # The synchronous lifespan startup chain (DB schema repair + 4 seed
    # routines: mock_data, admin_user, owner, locations) takes ~5–17 seconds
    # depending on environment — on AWS Lambda combined with ~10s of module
    # import this exceeds the 30s Lambda timeout, AND on the local Atoms
    # platform combined with ~21s of slow-FS import time it exceeds the
    # 60s `wait_for_backend_health` probe in `start_app_v2.sh`, so the
    # platform kills the backend before it ever serves a request.
    #
    # Fix: schedule heavy init as a background task on ALL environments.
    # `/health` answers within milliseconds while DB schema repair / seeding
    # finishes asynchronously. The `_db_initialized` flag in
    # `services/database.py` guards re-entry, so the first DB-touching
    # request blocks briefly on the init lock if it arrives before the
    # background task completes — vastly preferable to the platform's
    # health-check timing out and killing the worker.
    async def _run_full_init():
        try:
            await initialize_database()
            await initialize_mock_data()
            await initialize_admin_user()
            await initialize_owner_account()
            await initialize_locations()
            logger.info("=== Background init completed successfully ===")
        except Exception as exc:  # noqa: BLE001
            logger.error("=== Background init failed: %s ===", exc, exc_info=True)

    asyncio.create_task(_run_full_init())
    logger.info("Heavy init scheduled in background — /health is reachable now")
    # MODULE_STARTUP_END

    logger.info("=== Application startup completed successfully ===")
    yield
    # MODULE_SHUTDOWN_START
    await close_database()
    # MODULE_SHUTDOWN_END


app = FastAPI(
    title="FastAPI Modular Template",
    description="A best-practice FastAPI template with modular architecture",
    version="1.0.0",
    lifespan=lifespan,
)


# MODULE_MIDDLEWARE_START
# ─── Security Headers Middleware ───────────────────────────────────────────────
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response as StarletteResponse


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses to protect against common attacks."""

    async def dispatch(self, request: Request, call_next):
        response: StarletteResponse = await call_next(request)
        # Prevent clickjacking - only allow same-origin framing
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        # Prevent MIME type sniffing
        response.headers["X-Content-Type-Options"] = "nosniff"
        # Enable XSS protection in older browsers
        response.headers["X-XSS-Protection"] = "1; mode=block"
        # Control referrer information leakage
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        # Restrict browser features/permissions
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        # Force HTTPS (Strict Transport Security) - 1 year
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        # Content Security Policy - allow same-origin and common CDNs
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data: blob: https:; "
            "connect-src 'self' https: wss:; "
            "frame-ancestors 'self'"
        )
        return response


app.add_middleware(SecurityHeadersMiddleware)


# ─── No-Cache Middleware ───────────────────────────────────────────────────────
class NoCacheMiddleware(BaseHTTPMiddleware):
    """Prevent browsers/proxies from caching any response.

    Ensures users never see a stale version of the site or API after a new
    deployment. Auth cookies are NOT affected — only HTTP caching headers are
    overridden.
    """

    async def dispatch(self, request: Request, call_next):
        response: StarletteResponse = await call_next(request)
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response


app.add_middleware(NoCacheMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r".*",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "Origin", "X-Requested-With"],
    expose_headers=["Content-Length", "Content-Type"],
)
# MODULE_MIDDLEWARE_END


# Auto-discover and include all routers from the local `routers` package
def include_routers_from_package(app: FastAPI, package_name: str = "routers") -> None:
    """Discover and include all APIRouter objects from a package.

    This scans the given package (and subpackages) for module-level variables that
    are instances of FastAPI's APIRouter. It supports "router", "admin_router" names.
    """

    logger = logging.getLogger(__name__)

    try:
        pkg = importlib.import_module(package_name)
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.debug("Routers package '%s' not loaded: %s", package_name, exc)
        return

    discovered: int = 0
    for _finder, module_name, is_pkg in pkgutil.walk_packages(pkg.__path__, pkg.__name__ + "."):
        # Only import leaf modules; subpackages will be walked automatically
        if is_pkg:
            continue
        try:
            module = importlib.import_module(module_name)
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.warning("Failed to import module '%s': %s", module_name, exc)
            continue

        # Check for router variable names: router and admin_router
        for attr_name in ("router", "admin_router"):
            if not hasattr(module, attr_name):
                continue

            attr = getattr(module, attr_name)

            if isinstance(attr, APIRouter):
                app.include_router(attr)
                discovered += 1
                logger.info("Included router: %s.%s", module_name, attr_name)
            elif isinstance(attr, (list, tuple)):
                for idx, item in enumerate(attr):
                    if isinstance(item, APIRouter):
                        app.include_router(item)
                        discovered += 1
                        logger.info("Included router from list: %s.%s[%d]", module_name, attr_name, idx)

    if discovered == 0:
        logger.debug("No routers discovered in package '%s'", package_name)


# Setup logging before router discovery
setup_logging()
include_routers_from_package(app, "routers")


# ─── Static files mount for user uploads (e.g. site-visit attendance images) ──
# Files are written by routers (e.g. POST /api/v1/site-visits/upload-attendance)
# under <backend>/uploads/<subdir>/ and exposed read-only via /uploads/...
try:
    from fastapi.staticfiles import StaticFiles  # noqa: WPS433 — local import is fine

    # On AWS Lambda the deployed bundle (and therefore <backend>/) is mounted
    # READ-ONLY. The only writable location is /tmp. Any attempt to mkdir or
    # write under <backend>/uploads/ raises PermissionError, which is exactly
    # what the user is hitting in production ("تعذر حفظ المرفق"). Detect the
    # Lambda environment via the IS_LAMBDA env var (already set everywhere
    # else in this codebase) and redirect uploads to /tmp/uploads/.
    #
    # NOTE on persistence: Lambda's /tmp is per-execution-environment and
    # survives warm invocations on the same container, but is wiped on cold
    # starts and is NOT shared across concurrent containers. This is good
    # enough for short-term attachment review but for long-term storage the
    # app should be migrated to S3 / Atoms Cloud File Storage. For now this
    # fix unblocks the immediate "تعذر حفظ المرفق" error.
    _is_lambda = os.environ.get("IS_LAMBDA") == "true"
    _persistent_vol = os.environ.get("LOCAL_STORAGE_ROOT", "/data/uploads")
    if _is_lambda:
        _UPLOADS_DIR = "/tmp/uploads"
    elif os.path.isdir(_persistent_vol):
        _UPLOADS_DIR = _persistent_vol
    else:
        _UPLOADS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
    os.makedirs(_UPLOADS_DIR, exist_ok=True)
    # Also pre-create the site-visit-attendance subdir so the first upload
    # doesn't race a missing-folder error.
    os.makedirs(os.path.join(_UPLOADS_DIR, "site-visit-attendance"), exist_ok=True)
    # Expose the resolved path as an env var so routers can pick it up
    # without re-implementing the Lambda detection.
    os.environ["UPLOADS_DIR"] = _UPLOADS_DIR
    app.mount("/uploads", StaticFiles(directory=_UPLOADS_DIR), name="uploads")
    logging.getLogger(__name__).info(
        "Mounted /uploads -> %s (lambda=%s)", _UPLOADS_DIR, _is_lambda
    )
except Exception as _exc:  # noqa: BLE001
    logging.getLogger(__name__).error("Failed to mount /uploads: %s", _exc)


# Add exception handler for all exceptions except HTTPException
@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Handle all exceptions except HTTPException

    - Dev environment: Return full stack trace and exception details
    - Prod environment: Return only "Internal server error"
    """
    # Re-raise HTTPException to let FastAPI handle it normally
    if isinstance(exc, HTTPException):
        raise exc

    logger = logging.getLogger(__name__)
    error_message = str(exc)
    error_type = type(exc).__name__

    # Log full error details regardless of environment
    logger.error(f"Exception: {error_type}: {error_message}\n{traceback.format_exc()}")

    # Determine if we're in dev environment
    is_dev = os.getenv("ENVIRONMENT", "prod").lower() == "dev"

    if is_dev:
        # Dev environment: return full stack trace and exception details
        error_detail = f"{error_type}: {error_message}\n{traceback.format_exc()}"
        return JSONResponse(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, content={"detail": error_detail})
    else:
        # Prod environment: return only generic error message
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, content={"detail": "Internal Server Error"}
        )


@app.get("/")
def root():
    return {"message": "FastAPI Modular Template is running"}


@app.get("/health")
def health_check():
    return {"status": "healthy"}



@app.get("/api/v1/health/ping")
def health_ping():
    """Lightweight keep-alive endpoint. No DB access, no auth.
    Used by client-side and external schedulers (e.g. UptimeRobot)
    to prevent the backend from cold-starting after idle periods."""
    return {"status": "ok", "ts": datetime.utcnow().isoformat()}


# ─── Internal self keep-alive task ─────────────────────────────────────────────
# Runs a tiny no-op task every 4 minutes inside the running event loop. This
# keeps the worker process active on platforms that idle workers after a few
# minutes of no traffic. It does NOT make external HTTP calls — it just keeps
# the asyncio loop warm and prevents cold-starts of in-process state.
_keep_alive_task: "asyncio.Task | None" = None


async def _internal_keep_alive_loop():
    logger = logging.getLogger("keep_alive")
    while True:
        try:
            await asyncio.sleep(240)  # 4 minutes
            logger.debug("Internal keep-alive tick")
        except asyncio.CancelledError:
            break
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Keep-alive loop error: %s", exc)


@app.on_event("startup")
async def _start_keep_alive():
    global _keep_alive_task
    if _keep_alive_task is None or _keep_alive_task.done():
        _keep_alive_task = asyncio.create_task(_internal_keep_alive_loop())


@app.on_event("shutdown")
async def _stop_keep_alive():
    global _keep_alive_task
    if _keep_alive_task and not _keep_alive_task.done():
        _keep_alive_task.cancel()


def run_in_debug_mode(app: FastAPI):
    """Run the FastAPI app in debug mode with proper asyncio handling.

    This function handles the special case of running in a debugger (PyCharm, VS Code, etc.)
    where asyncio is patched, causing conflicts with uvicorn's asyncio_run.

    It loads environment variables from ../.env and uses asyncio.run() directly
    to avoid uvicorn's asyncio_run conflicts.

    Args:
        app: The FastAPI application instance
    """
    import asyncio
    from pathlib import Path

    import uvicorn
    from dotenv import load_dotenv

    # Load environment variables from ../.env in debug mode
    # If `LOCAL_DEBUG=true` is set, then MetaGPT's `ProjectBuilder.build()` will generate the `.env` file
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        load_dotenv(env_path, override=True)
        logger = logging.getLogger(__name__)
        logger.info(f"Loaded environment variables from {env_path}")

    # In debug mode, use asyncio.run() directly to avoid uvicorn's asyncio_run conflicts
    config = uvicorn.Config(
        app,
        host="0.0.0.0",
        port=int(settings.port),
        log_level="info",
    )
    server = uvicorn.Server(config)
    asyncio.run(server.serve())


if __name__ == "__main__":
    import sys

    import uvicorn

    # Detect if running in debugger (PyCharm, VS Code, etc.)
    # Debuggers patch asyncio which conflicts with uvicorn's asyncio_run
    is_debugging = "pydevd" in sys.modules or (hasattr(sys, "gettrace") and sys.gettrace() is not None)

    if is_debugging:
        run_in_debug_mode(app)
    else:
        # Enable reload in normal mode
        uvicorn.run(
            app,
            host="0.0.0.0",
            port=int(settings.port),
            reload_excludes=["**/*.py"],
        )
