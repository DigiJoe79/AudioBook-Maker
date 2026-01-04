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

# Set LOG_LEVEL as environment variable so it can be passed to Docker containers
os.environ['LOG_LEVEL'] = LOG_LEVEL


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
from fastapi import FastAPI, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from core.exceptions import ApplicationError  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
import uvicorn  # noqa: E402

# Add parent directory to path for imports
sys.path.append(str(Path(__file__).parent))

from api import health, tts, projects, chapters, segments, audio, settings, speakers, events, pronunciation, import_routes, epub_import_routes, engines, quality, jobs, engine_hosts  # noqa: E402
from db.database import init_database, get_db_connection_simple  # noqa: E402
from db.repositories import TTSJobRepository  # noqa: E402
from db.migration_runner import run_all_migrations  # noqa: E402
from config import EXPORTS_DIR, is_subprocess_available  # noqa: E402
from services.health_monitor import get_health_monitor, shutdown_health_monitor  # noqa: E402
from services.health_broadcaster import health_broadcaster  # noqa: E402
from services.engine_status_broadcaster import engine_status_broadcaster  # noqa: E402
from services.docker_host_monitor import docker_host_monitor  # noqa: E402
from core.tts_worker import get_tts_worker  # noqa: E402
from core.quality_worker import get_quality_worker  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Manage application lifecycle events

    This context manager handles startup and shutdown events
    using the modern FastAPI lifespan pattern.

    Note: Database initialization and migrations run in main() BEFORE
    asyncio.run() to ensure DB is ready before any engine managers
    access it during their initialization.

    Startup:
    - Initialize health monitor
    - Sync Docker images to engines table
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

    # Initialize health monitor singleton (separate thread for non-blocking health checks)
    # Note: Database is already initialized in main() before asyncio.run()
    get_health_monitor()

    # Cleanup orphaned Docker containers from previous sessions
    try:
        from services.docker_service import cleanup_orphaned_containers
        cleanup_count = cleanup_orphaned_containers()
        if cleanup_count > 0:
            logger.info(f"[Startup] Cleaned up {cleanup_count} orphaned Docker container(s)")
    except Exception as e:
        logger.debug(f"[Startup] Docker cleanup skipped: {e}")

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

    # Regenerate SSH configs for remote Docker hosts (lost after container rebuild)
    try:
        from services.ssh_key_service import get_ssh_key_service
        ssh_key_service = get_ssh_key_service()
        ssh_key_service.regenerate_all_ssh_configs()
    except Exception as e:
        logger.warning(f"Failed to regenerate SSH configs: {e}")

    # Start Docker Host Monitor (monitors Docker host connections)
    try:
        await docker_host_monitor.start()
    except Exception as e:
        logger.error(f"✗ Failed to start Docker Host Monitor: {e}")
        # Continue anyway - manual testing still works

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

        # Register DockerRunner if Docker is available
        try:
            from core.docker_runner import DockerRunner
            from core.engine_runner_registry import get_engine_runner_registry

            docker_runner = DockerRunner(image_prefix="audiobook-maker")
            registry = get_engine_runner_registry()
            registry.register_runner("docker:local", docker_runner)
            logger.info("[Startup] DockerRunner registered successfully")

            # Load persisted runner assignments from settings
            registry.load_assignments_from_settings()
        except RuntimeError as e:
            # Docker not available - this is expected on systems without Docker
            logger.debug(f"[Startup] Docker not available: {e}")
        except Exception as e:
            # Unexpected error - log but don't fail startup
            logger.warning(f"[Startup] Failed to register DockerRunner: {e}")

        # Register engines with model discovery
        async def register_engines_with_model_discovery():
            """
            Register all discovered engines in DB with async model discovery.

            For each NEW engine (not in DB):
            1. Register in engines table
            2. If installed: Start engine briefly (no model)
            3. Query /models endpoint to discover models
            4. Store models in engine_models table with first as default
            5. Stop engine

            For EXISTING engines: Just sync uninstalled status
            """
            from db.database import get_db_connection_simple
            from db.engine_repository import EngineRepository
            from db.engine_model_repository import EngineModelRepository

            logger.info("[Startup] Registering engines with model discovery...")

            conn = get_db_connection_simple()
            engine_repo = EngineRepository(conn)
            model_repo = EngineModelRepository(conn)

            all_managers = [
                ('tts', tts_manager),
                ('stt', stt_manager),
                ('text', text_manager),
                ('audio', audio_manager)
            ]

            new_count = 0
            discovered_count = 0
            failed_count = 0

            for engine_type, manager in all_managers:
                # 1. Discover local engines (only when subprocess is available)
                if is_subprocess_available():
                    discovered = manager.discover_local_engines()
                    # 2. Register in database
                    manager._register_local_engines_in_db(discovered)
                    # 3. Sync uninstalled engines
                    manager._sync_uninstalled_engines()
                else:
                    discovered = {}
                    logger.debug(f"Skipping subprocess discovery for {engine_type} (DEFAULT_ENGINE_RUNNER != local)")

                # 4. Discover models for NEW engines (those we just registered)
                for engine_name, metadata in discovered.items():
                    variant_id = f"{engine_name}:local"

                    try:
                        existing_engine = engine_repo.get_by_id(variant_id)

                        # Only discover models for NEW installed AND enabled engines
                        if not existing_engine or not existing_engine.get('is_installed'):
                            continue

                        # Skip disabled engines - no point discovering models
                        if not existing_engine.get('enabled'):
                            continue

                        # Check if this engine was just registered (no models yet)
                        existing_models = model_repo.get_by_variant(variant_id)
                        if existing_models:
                            # Models already exist, skip discovery
                            continue

                        # NEW ENGINE - discover models
                        logger.info(f"[Startup] Discovering models for new engine {variant_id}...")
                        new_count += 1

                        try:
                            # Start engine without loading a model
                            await manager.start_engine_for_discovery(variant_id)

                            # Query /models endpoint
                            models = await manager.discover_engine_models(variant_id)

                            if models:
                                # Extract model names from response
                                model_entries = []
                                for m in models:
                                    model_name = m.get("name") or m.get("engine_model_name") or m.get("model_name")
                                    if model_name:
                                        model_entries.append({"name": model_name, "info": m})

                                if model_entries:
                                    # Store in DB - first model is default
                                    model_repo.replace_models(variant_id, model_entries, preserve_default=False)
                                    if len(model_entries) > 0:
                                        model_repo.set_default_model(variant_id, model_entries[0]["name"])
                                    logger.info(f"[Startup] [OK] Discovered {len(model_entries)} models for {variant_id}")
                                    discovered_count += 1
                                else:
                                    logger.warning(f"[Startup] [WARN] No valid model names found for {variant_id}")
                            else:
                                logger.warning(f"[Startup] [WARN] No models returned from {variant_id}")

                            # Stop engine
                            await manager.stop_by_variant(variant_id)

                        except Exception as e:
                            logger.error(f"[Startup] [FAIL] Model discovery failed for {variant_id}: {e}")
                            failed_count += 1
                            # Engine still registered, just no models - that's okay

                    except Exception as e:
                        logger.error(f"[Startup] [FAIL] Failed to process {variant_id}: {e}")
                        failed_count += 1

            conn.close()

            if new_count > 0:
                logger.info(
                    f"[Startup] Model discovery complete: {discovered_count} successful, "
                    f"{failed_count} failed out of {new_count} new engines"
                )

        # Run registration with model discovery
        await register_engines_with_model_discovery()

        # Start keepRunning engines (no model discovery at startup)
        async def start_keep_running_engines():
            """
            Startup flow (simplified - no discovery):
            - If autostart=true: Start engines with keepRunning=true and load their default models

            Model discovery is now manual via /engines/{variant_id}/discover-models endpoint.
            """
            from services.settings_service import SettingsService
            from db.database import get_db_connection_simple

            # Get settings
            try:
                conn = get_db_connection_simple()
                settings_service = SettingsService(conn)
                autostart = settings_service.get_autostart_keep_running()
            except Exception as e:
                logger.warning(f"Could not get settings: {e}")
                autostart = True  # Default to True

            if not autostart:
                logger.info("Autostart disabled - no engines will be started")
                return

            all_managers = [tts_manager, stt_manager, text_manager, audio_manager]

            # Collect engines to start with keepRunning=true
            logger.info("Collecting keepRunning engines...")
            engines_to_start = []

            for manager in all_managers:
                engine_type = manager.engine_type
                for engine_name in manager.list_available_engines():
                    try:
                        keep_running = settings_service.get_engine_keep_running(engine_name, engine_type)

                        if keep_running:
                            # For single-engine types (STT, Audio, Text): only start if this is the default
                            # For TTS (multi-engine): start any engine with keepRunning=true
                            if engine_type in ('stt', 'audio', 'text'):
                                default_engine = settings_service.get_default_engine(engine_type)
                                if engine_name != default_engine:
                                    logger.debug(f"  Skipping {engine_type}/{engine_name}: keepRunning but not default")
                                    continue

                            # Get default model for this engine
                            # Note: engine_name is already a variant_id (e.g., 'chatterbox:local')
                            model_name = get_default_model(engine_name, engine_type, manager, settings_service)

                            if model_name:
                                engines_to_start.append((manager, engine_name, engine_type, model_name))
                            else:
                                logger.warning(f"  No model found for {engine_type}/{engine_name}, skipping")
                    except Exception as e:
                        logger.error(f"  Failed to prepare {engine_type}/{engine_name}: {e}")

            if not engines_to_start:
                logger.info("No keepRunning engines to start")
                return

            # Start all engines in parallel
            logger.info(f"Starting {len(engines_to_start)} keepRunning engine(s) in parallel...")

            async def start_single_engine(manager, engine_name, engine_type, model_name):
                """Start a single engine and return success status"""
                try:
                    logger.info(f"  Loading {engine_type}/{engine_name} (model: {model_name})...")
                    await manager.ensure_engine_ready(engine_name, model_name)
                    return engine_name, True, None
                except Exception as e:
                    return engine_name, False, str(e)

            # Run all engine starts concurrently
            results = await asyncio.gather(*[
                start_single_engine(mgr, name, etype, model)
                for mgr, name, etype, model in engines_to_start
            ])

            # Log results
            loaded_count = 0
            for engine_name, success, error in results:
                if success:
                    loaded_count += 1
                else:
                    logger.error(f"  Failed to load {engine_name}: {error}")

            logger.info(f"Startup complete: Loaded {loaded_count}/{len(engines_to_start)} keepRunning engines")

        def get_default_model(engine_name: str, engine_type: str, manager, settings_service) -> str:
            """Helper to get default model for an engine"""
            from db.engine_model_repository import EngineModelRepository
            from db.database import get_db_connection_simple

            if engine_type == 'text':
                # Text engines use language codes as model identifiers
                metadata = manager.get_engine_metadata(engine_name)
                if not metadata:
                    logger.warning(f"No metadata found for {engine_name}, using default language")
                    return 'en'
                supported_langs = metadata.get('supported_languages', ['en'])
                return supported_langs[0] if supported_langs else 'en'

            # For TTS/STT/Audio: Use engine_models table (SSOT for models)
            try:
                conn = get_db_connection_simple()
                model_repo = EngineModelRepository(conn)
                model_name = model_repo.get_default_or_first_model(engine_name)
                conn.close()
                return model_name or ''
            except Exception as e:
                logger.warning(f"Failed to get default model for {engine_name}: {e}")
                return ''

        # Run in background (non-blocking)
        asyncio.create_task(start_keep_running_engines())

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

    # Stop Docker Host Monitor
    try:
        await docker_host_monitor.stop()
        logger.debug("✓ Docker Host Monitor stopped")
    except asyncio.CancelledError:
        pass  # Expected during shutdown
    except Exception as e:
        logger.warning(f"Error stopping Docker Host Monitor: {e}")

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


# Global exception handler for ApplicationError
@app.exception_handler(ApplicationError)
async def application_error_handler(request: Request, exc: ApplicationError):
    """
    Convert ApplicationError to JSON response with proper status code.

    This ensures all ApplicationError subclasses are handled uniformly
    and their structured error codes are preserved for frontend i18n.
    """
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": str(exc)}
    )

# Configure CORS for Tauri Desktop App
# Allow localhost (dev) and tauri:// protocol (production)
# Additional origins can be added via CORS_ORIGINS environment variable (comma-separated)
_default_origins = [
    "http://localhost:5173",      # Vite dev server
    "http://127.0.0.1:5173",      # Vite dev server (IP variant)
    "http://localhost:1420",      # Tauri default dev server
    "http://127.0.0.1:1420",      # Tauri default dev server (IP variant)
    "http://tauri.localhost",     # Tauri production (Windows/Linux)
    "https://tauri.localhost",    # Tauri production (macOS)
    "tauri://localhost",          # Tauri custom protocol (alternative)
]
_extra_origins = os.getenv("CORS_ORIGINS", "").split(",") if os.getenv("CORS_ORIGINS") else []
_all_origins = _default_origins + [o.strip() for o in _extra_origins if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_all_origins,
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
app.include_router(audio.router, prefix="/api/audio", tags=["audio"])
app.include_router(settings.router, tags=["settings"])
app.include_router(speakers.router, tags=["speakers"])
app.include_router(events.router, tags=["events"])
app.include_router(pronunciation.router)
app.include_router(import_routes.router)
app.include_router(epub_import_routes.router)  # EPUB import routes (prefix in module)
app.include_router(quality.router)  # Quality router has prefix in module
app.include_router(engine_hosts.router)  # Engine hosts router

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
    parser.add_argument("--host", type=str, default=os.getenv("HOST", "127.0.0.1"),
                        help="Host to bind to (env: HOST)")
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

    # ===== DATABASE INITIALIZATION (must happen before any DB access) =====
    # Initialize database schema
    try:
        init_database()
        logger.debug("Database initialized")
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
        raise

    # Run database migrations
    try:
        backend_dir = Path(__file__).parent
        migrations_applied = run_all_migrations(str(backend_dir / "audiobook_maker.db"))
        if migrations_applied > 0:
            logger.info(f"Applied {migrations_applied} database migrations")
        else:
            logger.debug("No pending migrations")
    except Exception as e:
        logger.error(f"Failed to run migrations: {e}")
        # Continue anyway - migrations might already be applied

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
