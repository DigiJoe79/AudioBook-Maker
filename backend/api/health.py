"""
Health check and system control endpoints
"""

import asyncio
import os
from fastapi import APIRouter, Depends, BackgroundTasks
from core.exceptions import ApplicationError
import sqlite3
from loguru import logger
from models.response_models import HealthResponse, RootResponse, MessageResponse
from services.health_monitor import get_health_monitor
from db.database import get_db
from version import __version__

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health_check(conn: sqlite3.Connection = Depends(get_db)):
    """
    Health check endpoint - responds immediately even during heavy operations.

    Uses a separate monitoring thread to ensure non-blocking responses,
    preventing false "connection lost" warnings during TTS model loading.

    Also includes engine availability for frontend feature-gating.
    """
    try:
        # Get status from monitoring thread (non-blocking)
        monitor = get_health_monitor()
        status = monitor.get_status()

        # Get available TTS engines from engines table (Single Source of Truth)
        from db.engine_repository import EngineRepository
        engine_repo = EngineRepository(conn)

        # Get all enabled TTS engines from DB
        enabled_engines = engine_repo.get_enabled('tts')
        engines = [e['variant_id'] for e in enabled_engines]

        # Check if at least one engine is enabled for each type (from DB)
        has_tts_engine = len(enabled_engines) > 0
        has_text_engine = len(engine_repo.get_enabled('text')) > 0
        has_stt_engine = len(engine_repo.get_enabled('stt')) > 0

        return HealthResponse(
            status=status["status"],
            version=__version__,
            timestamp=status["timestamp"],
            database=status["database"],
            tts_engines=engines,
            busy=status["busy"],
            active_jobs=status["active_jobs"],
            has_tts_engine=has_tts_engine,
            has_text_engine=has_text_engine,
            has_stt_engine=has_stt_engine,
        )
    except Exception as e:
        raise ApplicationError("HEALTH_CHECK_FAILED", status_code=500, error=str(e))


@router.get("/", response_model=RootResponse)
async def root() -> RootResponse:
    """Root endpoint"""
    return RootResponse(
        name="Audiobook Maker API",
        version=__version__,
        status="online"
    )


async def _shutdown_sequence():
    """
    Execute graceful shutdown sequence.

    Order:
    1. Stop all engine containers via Docker API (direct, reliable)
    2. Stop engines via managers (for subprocess engines)
    3. Exit process
    """
    logger.info("[Shutdown] Starting graceful shutdown sequence...")

    # Stop all audiobook Docker containers directly via Docker API (in parallel)
    try:
        import docker
        from concurrent.futures import ThreadPoolExecutor, as_completed
        client = docker.from_env()

        # Find all running audiobook containers
        containers = client.containers.list(filters={'name': 'audiobook-'})
        if containers:
            logger.info(f"[Shutdown] Stopping {len(containers)} engine container(s) in parallel...")

            def stop_container(container):
                try:
                    container.stop(timeout=10)
                    return container.name, True, None
                except Exception as e:
                    return container.name, False, str(e)

            # Stop all containers in parallel
            with ThreadPoolExecutor(max_workers=len(containers)) as executor:
                futures = {executor.submit(stop_container, c): c for c in containers}
                for future in as_completed(futures):
                    name, success, error = future.result()
                    if success:
                        logger.info(f"[Shutdown] {name} stopped")
                    else:
                        logger.warning(f"[Shutdown] Failed to stop {name}: {error}")
        else:
            logger.info("[Shutdown] No engine containers running")
    except Exception as e:
        logger.error(f"[Shutdown] Error stopping Docker containers: {e}")

    # Also stop any subprocess engines via managers
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
    except Exception as e:
        logger.error(f"[Shutdown] Error stopping engine managers: {e}")

    logger.info("[Shutdown] All engines stopped")

    # Small delay to ensure response is sent
    await asyncio.sleep(0.5)

    # Exit with code 0 for clean shutdown (allows restart policies to work correctly)
    logger.info("[Shutdown] Exiting backend process...")
    os._exit(0)


@router.post("/shutdown", response_model=MessageResponse)
async def shutdown_backend(background_tasks: BackgroundTasks):
    """
    Gracefully shutdown the backend server.

    This endpoint:
    1. Stops all running engine containers
    2. Triggers graceful shutdown of the backend process

    The response is sent before the actual shutdown begins.
    """
    logger.info("[Shutdown] Shutdown requested via API")

    # Schedule shutdown in background so response can be sent first
    background_tasks.add_task(_shutdown_sequence)

    return MessageResponse(
        success=True,
        message="Shutdown initiated. All engines will be stopped and backend will terminate."
    )
