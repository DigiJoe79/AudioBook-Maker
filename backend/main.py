"""
Audiobook Maker Backend
FastAPI server for TTS generation and audio processing
"""

import os
import sys
import argparse
from pathlib import Path
from version import __version__  # noqa: F401 - Exposed for API access

# IMPORTANT: Parse --enable-dummy flag BEFORE importing any modules
# This ensures the environment variable is set before TTSManager is initialized
if '--enable-dummy' in sys.argv:
    os.environ['ENABLE_DUMMY_TTS'] = '1'

from loguru import logger


# ==================== Loguru Configuration ====================
# CRITICAL: Configure logging BEFORE importing backend modules to ensure all logs use the same format

def configure_logging():
    """
    Configure loguru with unified format across the entire backend

    Format: HH:MM:SS.mmm | LEVEL | module:function:line - message
    Example: 21:09:07.065 | INFO     | services.xtts_engine:get_available_models_static:259 - Found 2 XTTS models
    """
    import logging

    # Remove default handler
    logger.remove()

    # Add custom handler with unified format (no date) and colors
    logger.add(
        sys.stderr,
        format="<green>{time:HH:mm:ss.SSS}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
        level="INFO",
        colorize=True
    )

    # Intercept standard logging (for libraries using logging instead of loguru)
    class InterceptHandler(logging.Handler):
        def emit(self, record):
            # Get corresponding Loguru level if it exists
            try:
                level = logger.level(record.levelname).name
            except ValueError:
                level = record.levelno

            # Find caller from where originated the logged message
            frame, depth = logging.currentframe(), 2
            while frame.f_code.co_filename == logging.__file__:
                frame = frame.f_back
                depth += 1

            logger.opt(depth=depth, exception=record.exc_info).log(level, record.getMessage())

    # Intercept all standard logging
    logging.basicConfig(handlers=[InterceptHandler()], level=0, force=True)

    # Configure uvicorn loggers explicitly
    for logger_name in ["uvicorn", "uvicorn.error", "uvicorn.access"]:
        uvicorn_logger = logging.getLogger(logger_name)
        uvicorn_logger.handlers = [InterceptHandler()]
        uvicorn_logger.propagate = False

    # Set uvicorn loggers to WARNING (reduce noise)
    logging.getLogger("uvicorn").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.error").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

    # Disable HTTP request logs
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


# Configure logging NOW, before importing backend modules
configure_logging()

# Now import backend modules (they will use the configured loguru format)
# Note: Imports must be after logger configuration to use correct format
import asyncio  # noqa: E402
from contextlib import asynccontextmanager  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
import uvicorn  # noqa: E402

# Add parent directory to path for imports
sys.path.append(str(Path(__file__).parent))

from api import health, tts, projects, chapters, segments, text_processing, audio, settings, speakers, events  # noqa: E402
from db.database import init_database, get_db_connection_simple  # noqa: E402
from db.repositories import TTSJobRepository  # noqa: E402
from db.migration_runner import run_all_migrations  # noqa: E402
from config import OUTPUT_DIR, EXPORTS_DIR  # noqa: E402
from services.health_monitor import get_health_monitor, shutdown_health_monitor  # noqa: E402
from services.health_broadcaster import health_broadcaster  # noqa: E402
from core.tts_worker import get_tts_worker  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Manage application lifecycle events

    This context manager handles startup and shutdown events
    using the modern FastAPI lifespan pattern.

    Startup:
    - Initialize health monitor
    - Initialize database
    - Run migrations
    - Reset stuck jobs from previous crash
    - Start TTS worker thread

    Shutdown:
    - Stop worker gracefully
    - Shutdown health monitor
    """
    # ===== STARTUP =====
    logger.info("🚀 Starting Audiobook Maker API...")

    # Initialize health monitor (separate thread for non-blocking health checks)
    health_monitor = get_health_monitor()

    # Initialize database
    try:
        init_database()
        health_monitor.set_database_status(True)
    except Exception as e:
        health_monitor.set_database_status(False)
        logger.error(f"✗ Database initialization failed: {e}")
        raise

    # Run database migrations
    try:
        from pathlib import Path
        backend_dir = Path(__file__).parent
        migrations_applied = run_all_migrations(str(backend_dir / "audiobook_maker.db"))
        if migrations_applied > 0:
            logger.info(f"✓ Applied {migrations_applied} database migrations")
        else:
            logger.debug("No pending migrations")
    except Exception as e:
        logger.error(f"✗ Failed to run migrations: {e}")
        # Continue anyway - migrations might already be applied

    # Reset stuck jobs from previous session (if any)
    try:
        conn = get_db_connection_simple()
        job_repo = TTSJobRepository(conn)
        stuck_count = job_repo.reset_stuck_jobs()

        if stuck_count > 0:
            logger.warning(f"⚠ Reset {stuck_count} stuck jobs from previous session")

    except Exception as e:
        logger.error(f"Failed to reset stuck jobs: {e}")

    # Start TTS Worker (background thread)
    try:
        # Get current event loop and pass to worker for SSE event emission
        event_loop = asyncio.get_running_loop()
        worker = get_tts_worker(event_loop=event_loop)
        worker.start()
    except Exception as e:
        logger.error(f"✗ Failed to start TTS worker: {e}")
        # Continue anyway - API can still queue jobs

    # Start Health Broadcaster (broadcasts health via SSE every 5s)
    try:
        await health_broadcaster.start()
    except Exception as e:
        logger.error(f"✗ Failed to start Health Broadcaster: {e}")
        # Continue anyway - polling fallback will work

    # Load default engine in background (non-blocking)
    try:
        from core.engine_manager import get_engine_manager
        manager = get_engine_manager()
        asyncio.create_task(manager.load_default_engine())
        logger.info("⏳ Default engine loading in background...")
    except Exception as e:
        logger.error(f"✗ Failed to start engine loading: {e}")
        # Continue anyway - engine will be loaded on first job

    logger.info("✓ Startup complete | API docs at /docs")

    yield  # Application runs here

    # ===== SHUTDOWN =====
    logger.info("🛑 Shutting down...")

    # Stop Health Broadcaster first
    try:
        await health_broadcaster.stop()
        logger.info("✓ Health Broadcaster stopped")
    except Exception as e:
        logger.error(f"Error stopping Health Broadcaster: {e}")

    # Stop TTS worker gracefully (wait max 10s for current job)
    try:
        worker = get_tts_worker()
        worker.stop(timeout=10.0)
        logger.info("✓ TTS Worker stopped")
    except Exception as e:
        logger.error(f"Error stopping TTS worker: {e}")

    # Shutdown health monitor
    shutdown_health_monitor()

    logger.info("✓ Shutdown complete")


# Create FastAPI app with lifespan handler
app = FastAPI(
    title="Audiobook Maker API",
    description="Backend API for audiobook generation with XTTS",
    version="0.1.0",
    lifespan=lifespan
)

# Configure CORS for Tauri Desktop App
# Allow localhost (dev) and tauri:// protocol (production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",      # Vite dev server
        "http://localhost:1420",      # Tauri default dev server
        "http://tauri.localhost",     # Tauri production (Windows/Linux)
        "https://tauri.localhost",    # Tauri production (macOS)
        "tauri://localhost",          # Tauri custom protocol (alternative)
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


# Audio Cache-Control Middleware
# Sets aggressive caching headers for /audio/* files since we use cache-busting query parameters
@app.middleware("http")
async def add_audio_cache_headers(request, call_next):
    response = await call_next(request)

    # Only apply to /audio/ static files
    if request.url.path.startswith("/audio/"):
        # Aggressive caching is safe with cache-busting query parameters (?v=timestamp)
        # Each version has unique URL, so browser caches correctly
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"  # 1 year

    return response


# Include routers
app.include_router(health.router, tags=["health"])
app.include_router(tts.router, prefix="/api/tts", tags=["tts"])
app.include_router(projects.router, prefix="/api", tags=["projects"])
app.include_router(chapters.router, prefix="/api", tags=["chapters"])
app.include_router(segments.router, prefix="/api", tags=["segments"])
app.include_router(text_processing.router, prefix="/api", tags=["text-processing"])
app.include_router(audio.router, prefix="/api/audio", tags=["audio"])
app.include_router(settings.router, tags=["settings"])
app.include_router(speakers.router, tags=["speakers"])
app.include_router(events.router, tags=["events"])

# Mount static files for audio output
output_dir = Path(OUTPUT_DIR)
output_dir.mkdir(parents=True, exist_ok=True)
app.mount("/audio", StaticFiles(directory=str(output_dir)), name="audio")

# Mount static files for exported audiobooks
exports_dir = Path(EXPORTS_DIR)
exports_dir.mkdir(parents=True, exist_ok=True)
app.mount("/exports", StaticFiles(directory=str(exports_dir)), name="exports")


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description="Audiobook Maker Backend")
    parser.add_argument("--port", type=int, default=8765, help="Port to listen on")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host to bind to")
    parser.add_argument("--enable-dummy", action="store_true",
                        help="Enable dummy TTS engine (for development/testing)")
    args = parser.parse_args()

    logger.info(f"Starting server on {args.host}:{args.port}")

    # Display dummy engine status (already set at module import time)
    if args.enable_dummy:
        logger.info("Dummy TTS engine enabled")

    # Show available engines
    from core.engine_manager import get_engine_manager
    manager = get_engine_manager()
    available_engines = manager.list_available_engines()
    logger.info(f"Available TTS engines: {', '.join(available_engines)}")

    # Run uvicorn with log_config=None to prevent it from reconfiguring loggers
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_config=None,  # Don't override our loguru configuration
        access_log=False  # Disable access logs for cleaner output
    )


if __name__ == "__main__":
    main()
