"""
Audiobook Maker Backend
FastAPI server for TTS generation and audio processing
"""

import os
import sys
import argparse
from pathlib import Path
from version import __version__  # noqa: F401 - Exposed for API access

from loguru import logger


# ==================== Debug Mode Detection ====================
# Detect debug mode from environment variables BEFORE configuring logging

def detect_debug_mode() -> bool:
    """
    Detect if debug mode is enabled via environment variables or CLI flags

    Returns:
        True if debug mode is enabled, False otherwise

    Debug mode can be enabled via:
    - Environment variable: DEBUG=1
    - Environment variable: LOG_LEVEL=DEBUG
    - Command-line flag: --debug
    """
    # Check environment variables
    env_debug = os.getenv("DEBUG", "0") == "1"
    env_log_level = os.getenv("LOG_LEVEL", "INFO").upper() == "DEBUG"

    # Check CLI flag (--debug in sys.argv)
    cli_debug = "--debug" in sys.argv

    return env_debug or env_log_level or cli_debug


# Determine log level based on debug mode
DEBUG_MODE = detect_debug_mode()
LOG_LEVEL = "DEBUG" if DEBUG_MODE else "INFO"


# ==================== Loguru Configuration ====================
# CRITICAL: Configure logging BEFORE importing backend modules to ensure all logs use the same format

def configure_logging(log_level: str = "INFO") -> None:
    """
    Configure loguru with unified format across the entire backend

    Format: HH:MM:SS.mmm | LEVEL | module:function:line - message
    Example: 21:09:07.065 | INFO     | services.xtts_engine:get_available_models_static:259 - Found 2 XTTS models

    Args:
        log_level: Log level to use (DEBUG or INFO). Can be controlled via:
                  - Environment variable: DEBUG=1 or LOG_LEVEL=DEBUG
                  - Command-line flag: --debug
    """
    import logging

    # Remove default handler
    logger.remove()

    # Add custom handler with unified format (no date) and colors
    logger.add(
        sys.stderr,
        format="<green>{time:HH:mm:ss.SSS}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
        level=log_level,
        colorize=True
    )

    # Intercept standard logging (for libraries using logging instead of loguru)
    class InterceptHandler(logging.Handler):
        # Suppress these messages during graceful shutdown (expected, not errors)
        SHUTDOWN_NOISE = [
            "timeout graceful shutdown exceeded",
            "Exception in ASGI application",
            "Cancel",  # "Cancel N running task(s)"
        ]

        def emit(self, record):
            # Filter out noisy shutdown messages
            msg = record.getMessage()
            if any(noise in msg for noise in self.SHUTDOWN_NOISE):
                return  # Suppress this message

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
configure_logging(log_level=LOG_LEVEL)

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

from api import health, tts, projects, chapters, segments, text_processing, audio, settings, speakers, events, pronunciation, import_routes, engines, quality, jobs  # noqa: E402
from db.database import init_database, get_db_connection_simple  # noqa: E402
from db.repositories import TTSJobRepository  # noqa: E402
from db.migration_runner import run_all_migrations  # noqa: E402
from config import EXPORTS_DIR  # noqa: E402
from services.health_monitor import get_health_monitor, shutdown_health_monitor  # noqa: E402
from services.health_broadcaster import health_broadcaster  # noqa: E402
from services.engine_status_broadcaster import engine_status_broadcaster  # noqa: E402
from core.tts_worker import get_tts_worker  # noqa: E402
from core.quality_worker import get_quality_worker  # noqa: E402


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
    - Start Quality worker thread
    - Initialize all engine managers (TTS, STT, Text, Audio)
    - Load default TTS engine

    Shutdown:
    - Stop Health Broadcaster
    - Stop TTS worker gracefully
    - Stop Quality worker gracefully
    - Shutdown all engine managers
    - Shutdown health monitor
    """
    # ===== STARTUP =====
    logger.debug("🚀 Starting Audiobook Maker API...")

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

        # Reset TTS jobs
        tts_job_repo = TTSJobRepository(conn)
        tts_stuck_count = tts_job_repo.reset_stuck_jobs()
        if tts_stuck_count > 0:
            logger.warning(f"⚠ Reset {tts_stuck_count} stuck TTS jobs from previous session")

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

    # Start Quality Worker (background thread)
    try:
        event_loop = asyncio.get_running_loop()
        quality_worker = get_quality_worker(event_loop=event_loop)
        quality_worker.start()
    except Exception as e:
        logger.error(f"✗ Failed to start Quality worker: {e}")
        # Continue anyway - API can still queue jobs

    # Start Health Broadcaster (broadcasts health via SSE every 30s)
    try:
        await health_broadcaster.start()
    except Exception as e:
        logger.error(f"✗ Failed to start Health Broadcaster: {e}")
        # Continue anyway - polling fallback will work

    # Start Engine Status Broadcaster (broadcasts engine status via SSE every 15s)
    try:
        await engine_status_broadcaster.start()
    except Exception as e:
        logger.error(f"✗ Failed to start Engine Status Broadcaster: {e}")
        # Continue anyway - polling fallback will work

    # Initialize all engine managers
    try:
        from core.tts_engine_manager import get_tts_engine_manager
        from core.stt_engine_manager import get_stt_engine_manager
        from core.text_engine_manager import get_text_engine_manager
        from core.audio_engine_manager import get_audio_engine_manager

        tts_manager = get_tts_engine_manager()
        stt_manager = get_stt_engine_manager()
        text_manager = get_text_engine_manager()
        audio_manager = get_audio_engine_manager()

        # Discover models and start keepRunning engines
        async def discover_and_start_engines():
            """
            New startup flow:
            1. Discover ALL engines in parallel (no model load)
            2. Stop engines without keepRunning=true
            3. If autostart=true: Load models for keepRunning engines
            """
            from services.settings_service import SettingsService
            from db.database import get_db_connection_simple

            # Get settings
            try:
                conn = get_db_connection_simple()
                settings_service = SettingsService(conn)

                # CRITICAL: Merge discovered engines into settings BEFORE discovery
                # This ensures is_engine_enabled() has correct data for all engines.
                # Without this, engines not yet in DB would incorrectly appear as disabled.
                settings_service.get_all_settings()

                autostart = settings_service.get_autostart_keep_running()
            except Exception as e:
                logger.warning(f"Could not get settings: {e}")
                autostart = True  # Default to True

            all_managers = [tts_manager, stt_manager, text_manager, audio_manager]

            # ===== PHASE 1: Discover ALL engines in parallel =====
            logger.info("Phase 1: Discovering all engines...")
            discovery_tasks = []

            for manager in all_managers:
                for engine_name in manager.list_available_engines():
                    discovery_tasks.append(manager.discover_engine_models(engine_name))

            if discovery_tasks:
                results = await asyncio.gather(*discovery_tasks, return_exceptions=True)
                # Log any discovery errors
                for i, result in enumerate(results):
                    if isinstance(result, Exception):
                        logger.warning(f"Discovery failed for an engine: {result}")

            logger.info(f"Phase 1 complete: Discovered {len(discovery_tasks)} engines")

            # ===== PHASE 2: Stop engines without keepRunning =====
            logger.info("Phase 2: Stopping non-keepRunning engines...")
            stopped_count = 0

            for manager in all_managers:
                engine_type = manager.engine_type
                for engine_name in list(manager.engine_processes.keys()):
                    try:
                        keep_running = settings_service.get_engine_keep_running(engine_name, engine_type)

                        # Stop if: autostart is off OR engine doesn't have keepRunning
                        if not autostart or not keep_running:
                            logger.debug(f"  Stopping {engine_type}/{engine_name} (keepRunning={keep_running}, autostart={autostart})")
                            from config import ENGINE_SHUTDOWN_TIMEOUT
                            await manager.stop_engine_server(engine_name, timeout=ENGINE_SHUTDOWN_TIMEOUT)
                            stopped_count += 1
                    except Exception as e:
                        logger.warning(f"  Failed to stop {engine_type}/{engine_name}: {e}")

            logger.info(f"Phase 2 complete: Stopped {stopped_count} engines")

            # ===== PHASE 3: Load models for keepRunning engines =====
            if not autostart:
                logger.info("Phase 3: Skipped (autostart is disabled)")
                return

            logger.info("Phase 3: Loading models for keepRunning engines...")
            loaded_count = 0

            for manager in all_managers:
                engine_type = manager.engine_type
                for engine_name in manager.list_available_engines():
                    try:
                        keep_running = settings_service.get_engine_keep_running(engine_name, engine_type)

                        if keep_running:
                            # Get default model for this engine
                            model_name = get_default_model(engine_name, engine_type, manager, settings_service)

                            if model_name:
                                logger.info(f"  Loading {engine_type}/{engine_name} (model: {model_name})...")
                                await manager.ensure_engine_ready(engine_name, model_name)
                                loaded_count += 1
                            else:
                                logger.warning(f"  No model found for {engine_type}/{engine_name}, skipping")
                    except Exception as e:
                        logger.error(f"  Failed to load {engine_type}/{engine_name}: {e}")

            logger.info(f"Phase 3 complete: Loaded {loaded_count} keepRunning engines")

        def get_default_model(engine_name: str, engine_type: str, manager, settings_service) -> str:
            """Helper to get default model for an engine"""
            model_name = None

            if engine_type in ('tts', 'stt', 'audio'):
                model_name = settings_service.get_default_model_for_engine(engine_name, engine_type)
            elif engine_type == 'text':
                metadata = manager._engine_metadata.get(engine_name, {})
                supported_langs = metadata.get('supported_languages', ['en'])
                model_name = supported_langs[0] if supported_langs else 'en'

            # Fallback to first model from metadata
            if not model_name:
                metadata = manager._engine_metadata.get(engine_name, {})
                models = metadata.get('models', [])
                if models:
                    if isinstance(models[0], dict):
                        model_name = models[0].get('engine_model_name')
                    else:
                        model_name = models[0]

            return model_name

        # Run in background (non-blocking)
        asyncio.create_task(discover_and_start_engines())

        # Start idle engine checker
        async def idle_engine_checker():
            """Background task to stop idle engines"""
            from config import IDLE_ENGINE_CHECK_INTERVAL
            while True:
                await asyncio.sleep(IDLE_ENGINE_CHECK_INTERVAL)
                try:
                    # Check all engine managers
                    await tts_manager.check_idle_engines()
                    await stt_manager.check_idle_engines()
                    await text_manager.check_idle_engines()
                    await audio_manager.check_idle_engines()
                except Exception as e:
                    logger.error(f"Idle engine check failed: {e}")

        asyncio.create_task(idle_engine_checker())
        logger.debug("✓ Idle engine checker started (checks every 60s)")

        logger.success("✓ All engine managers initialized")
    except Exception as e:
        logger.error(f"✗ Failed to initialize engine managers: {e}")
        # Continue anyway - engines will be loaded on first job

    logger.debug("✓ Startup complete | API docs at /docs")

    yield  # Application runs here

    # ===== SHUTDOWN =====
    logger.info("🛑 Shutting down...")

    # Stop Health Broadcaster first
    try:
        await health_broadcaster.stop()
        logger.debug("✓ Health Broadcaster stopped")
    except asyncio.CancelledError:
        pass  # Expected during shutdown
    except Exception as e:
        logger.warning(f"Error stopping Health Broadcaster: {e}")

    # Stop Engine Status Broadcaster
    try:
        await engine_status_broadcaster.stop()
        logger.debug("✓ Engine Status Broadcaster stopped")
    except asyncio.CancelledError:
        pass  # Expected during shutdown
    except Exception as e:
        logger.warning(f"Error stopping Engine Status Broadcaster: {e}")

    # Stop TTS worker gracefully (wait max 10s for current job)
    try:
        worker = get_tts_worker()
        from config import WORKER_STOP_TIMEOUT
        worker.stop(timeout=WORKER_STOP_TIMEOUT)
        logger.debug("✓ TTS Worker stopped")
    except Exception as e:
        logger.warning(f"Error stopping TTS worker: {e}")

    # Stop Quality worker gracefully (wait max 10s for current job)
    try:
        quality_worker = get_quality_worker()
        from config import WORKER_STOP_TIMEOUT
        quality_worker.stop(timeout=WORKER_STOP_TIMEOUT)
        logger.debug("✓ Quality Worker stopped")
    except Exception as e:
        logger.warning(f"Error stopping Quality worker: {e}")

    # Shutdown all engine managers
    try:
        from core.tts_engine_manager import get_tts_engine_manager
        from core.stt_engine_manager import get_stt_engine_manager
        from core.text_engine_manager import get_text_engine_manager
        from core.audio_engine_manager import get_audio_engine_manager

        tts_manager = get_tts_engine_manager()
        stt_manager = get_stt_engine_manager()
        text_manager = get_text_engine_manager()
        audio_manager = get_audio_engine_manager()

        await tts_manager.shutdown_all_engines()
        await stt_manager.shutdown_all_engines()
        await text_manager.shutdown_all_engines()
        await audio_manager.shutdown_all_engines()
        logger.debug("✓ All engines shutdown")
    except asyncio.CancelledError:
        pass  # Expected during shutdown
    except Exception as e:
        logger.warning(f"Error shutting down engines: {e}")

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
        "http://127.0.0.1:5173",      # Vite dev server (IP variant)
        "http://localhost:1420",      # Tauri default dev server
        "http://127.0.0.1:1420",      # Tauri default dev server (IP variant)
        "http://tauri.localhost",     # Tauri production (Windows/Linux)
        "https://tauri.localhost",    # Tauri production (macOS)
        "tauri://localhost",          # Tauri custom protocol (alternative)
    ],
    allow_credentials=True,
    allow_methods=["GET", "FETCH", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
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
        from config import STATIC_AUDIO_CACHE_MAX_AGE
        response.headers["Cache-Control"] = f"public, max-age={STATIC_AUDIO_CACHE_MAX_AGE}, immutable"

    return response


# Include routers
app.include_router(health.router, tags=["health"])
app.include_router(tts.router, prefix="/api/tts", tags=["tts"])
app.include_router(jobs.router)  # Jobs router has prefix in module (/api/jobs)
app.include_router(engines.router, prefix="/api", tags=["engines"])
app.include_router(projects.router, prefix="/api", tags=["projects"])
app.include_router(chapters.router, prefix="/api", tags=["chapters"])
app.include_router(segments.router, prefix="/api", tags=["segments"])
app.include_router(text_processing.router, prefix="/api", tags=["text-processing"])
app.include_router(audio.router, prefix="/api/audio", tags=["audio"])
app.include_router(settings.router, tags=["settings"])
app.include_router(speakers.router, tags=["speakers"])
app.include_router(events.router, tags=["events"])
app.include_router(pronunciation.router)
app.include_router(import_routes.router)
app.include_router(quality.router)  # Quality router has prefix in module

# Audio files are now served via /api/audio/{file_path} endpoint
# This ensures CORS middleware is applied correctly
# (app.mount() bypasses middleware, causing CORS issues)

# Mount static files for exported audiobooks
exports_dir = Path(EXPORTS_DIR)
exports_dir.mkdir(parents=True, exist_ok=True)
app.mount("/exports", StaticFiles(directory=str(exports_dir)), name="exports")


def main() -> None:
    """Main entry point"""
    parser = argparse.ArgumentParser(description="Audiobook Maker Backend")
    parser.add_argument("--port", type=int, default=8765, help="Port to listen on")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host to bind to")
    parser.add_argument("--enable-dummy", action="store_true",
                        help="Enable dummy TTS engine (for development/testing)")
    parser.add_argument("--debug", action="store_true",
                        help="Enable DEBUG logging (verbose output for development)")
    args = parser.parse_args()

    # Log the active log level
    logger.debug(f"Logging level: {LOG_LEVEL}")
    if DEBUG_MODE:
        logger.debug("Debug mode is active - verbose logging enabled")

    logger.debug(f"Starting server on {args.host}:{args.port}")

    # Display dummy engine status (already set at module import time)
    if args.enable_dummy:
        logger.info("Dummy TTS engine enabled")

    # Show available engines
    from core.tts_engine_manager import get_tts_engine_manager
    tts_manager = get_tts_engine_manager()
    available_engines = tts_manager.list_available_engines()
    logger.debug(f"Available TTS engines: {', '.join(available_engines)}")

    # Configure uvicorn server with timeout for graceful shutdown
    # timeout_graceful_shutdown: Max seconds to wait for connections to close on Ctrl+C
    # Without this, SSE connections keep the server hanging indefinitely
    config = uvicorn.Config(
        app,
        host=args.host,
        port=args.port,
        log_config=None,  # Don't override our loguru configuration
        access_log=False,  # Disable access logs for cleaner output
        timeout_graceful_shutdown=3  # Force shutdown after 3 seconds if connections don't close
    )
    server = uvicorn.Server(config)

    # Custom exception handler to suppress harmless errors during shutdown
    def asyncio_exception_handler(loop, context):
        exception = context.get('exception')
        # Suppress harmless "connection reset by remote host" errors on Windows
        # These occur when client disconnects before server finishes
        if isinstance(exception, ConnectionResetError):
            return
        # Suppress CancelledError during graceful shutdown (SSE connections being terminated)
        if isinstance(exception, asyncio.CancelledError):
            return
        # For all other exceptions, use default handler
        loop.default_exception_handler(context)

    # Wrapper to install exception handler and log Ctrl+C immediately
    async def serve_with_handler():
        loop = asyncio.get_running_loop()
        loop.set_exception_handler(asyncio_exception_handler)

        # Log immediately when Ctrl+C is pressed (before uvicorn's graceful shutdown)
        import signal
        original_handler = signal.getsignal(signal.SIGINT)

        def sigint_handler(signum, frame):
            logger.info("Received Ctrl+C, waiting for connections to close...")
            # Call original handler (uvicorn's) to trigger graceful shutdown
            if callable(original_handler):
                original_handler(signum, frame)

        signal.signal(signal.SIGINT, sigint_handler)

        # Let uvicorn handle its own signals (built-in SIGINT/SIGTERM handling)
        await server.serve()

    # Run the server - let KeyboardInterrupt propagate naturally for clean Ctrl+C
    try:
        asyncio.run(serve_with_handler())
    except (KeyboardInterrupt, SystemExit, asyncio.CancelledError):
        # Clean exit - lifespan already logged "Shutdown complete"
        pass


if __name__ == "__main__":
    main()
