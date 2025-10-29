"""
Audiobook Maker Backend
FastAPI server for TTS generation and audio processing
"""

import os
import sys
import argparse
from pathlib import Path
from version import __version__  # noqa: F401 - Exposed for API access

if '--enable-dummy' in sys.argv:
    os.environ['ENABLE_DUMMY_TTS'] = '1'

from loguru import logger



def configure_logging():
    """
    Configure loguru with unified format across the entire backend

    Format: HH:MM:SS.mmm | LEVEL | module:function:line - message
    Example: 21:09:07.065 | INFO     | services.xtts_engine:get_available_models_static:259 - Found 2 XTTS models
    """
    import logging

    logger.remove()

    logger.add(
        sys.stderr,
        format="<green>{time:HH:mm:ss.SSS}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
        level="INFO",
        colorize=True
    )

    class InterceptHandler(logging.Handler):
        def emit(self, record):
            try:
                level = logger.level(record.levelname).name
            except ValueError:
                level = record.levelno

            frame, depth = logging.currentframe(), 2
            while frame.f_code.co_filename == logging.__file__:
                frame = frame.f_back
                depth += 1

            logger.opt(depth=depth, exception=record.exc_info).log(level, record.getMessage())

    logging.basicConfig(handlers=[InterceptHandler()], level=0, force=True)

    for logger_name in ["uvicorn", "uvicorn.error", "uvicorn.access"]:
        uvicorn_logger = logging.getLogger(logger_name)
        uvicorn_logger.handlers = [InterceptHandler()]
        uvicorn_logger.propagate = False

    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


configure_logging()

from contextlib import asynccontextmanager  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
import uvicorn  # noqa: E402

sys.path.append(str(Path(__file__).parent))

from api import health, tts, projects, chapters, segments, text_processing, audio, settings, speakers  # noqa: E402
from db.database import init_database  # noqa: E402
from config import OUTPUT_DIR, EXPORTS_DIR  # noqa: E402
from services.health_monitor import get_health_monitor, shutdown_health_monitor  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Manage application lifecycle events

    This context manager handles startup and shutdown events
    using the modern FastAPI lifespan pattern.
    """
    logger.info("Starting Audiobook Maker API...")

    health_monitor = get_health_monitor()
    logger.info("Health monitor started")

    try:
        init_database()
        health_monitor.set_database_status(True)
        logger.info("Database initialized")
    except Exception as e:
        health_monitor.set_database_status(False)
        logger.error(f"Database initialization failed: {e}")
        raise

    logger.info("API documentation available at /docs")
    logger.info("Startup complete")

    yield

    logger.info("Shutting down...")
    shutdown_health_monitor()
    logger.info("Shutdown complete")


app = FastAPI(
    title="Audiobook Maker API",
    description="Backend API for audiobook generation with XTTS",
    version="0.1.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:1420",
        "http://tauri.localhost",
        "https://tauri.localhost",
        "tauri://localhost",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(health.router, tags=["health"])
app.include_router(tts.router, prefix="/api/tts", tags=["tts"])
app.include_router(projects.router, prefix="/api", tags=["projects"])
app.include_router(chapters.router, prefix="/api", tags=["chapters"])
app.include_router(segments.router, prefix="/api", tags=["segments"])
app.include_router(text_processing.router, prefix="/api", tags=["text-processing"])
app.include_router(audio.router, prefix="/api/audio", tags=["audio"])
app.include_router(settings.router, tags=["settings"])
app.include_router(speakers.router, tags=["speakers"])

output_dir = Path(OUTPUT_DIR)
output_dir.mkdir(parents=True, exist_ok=True)
app.mount("/audio", StaticFiles(directory=str(output_dir)), name="audio")

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

    if args.enable_dummy:
        logger.info("Dummy TTS engine enabled")

    from services.tts_manager import get_tts_manager
    manager = get_tts_manager()
    available_engines = manager.list_available_engines()
    logger.info(f"Available TTS engines: {', '.join(available_engines)}")

    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_config=None,
        access_log=False
    )


if __name__ == "__main__":
    main()
