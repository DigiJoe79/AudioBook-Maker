"""
Health check endpoints
"""

from fastapi import APIRouter, Depends, HTTPException
import sqlite3
from models.response_models import HealthResponse, RootResponse
from services.health_monitor import get_health_monitor
from services.settings_service import SettingsService
from core.tts_engine_manager import get_tts_engine_manager
from core.text_engine_manager import get_text_engine_manager
from core.stt_engine_manager import get_stt_engine_manager
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

        # Get available TTS engines
        tts_manager = get_tts_engine_manager()
        engines = tts_manager.list_available_engines()

        # Get engine availability for feature-gating
        settings_service = SettingsService(conn)
        text_manager = get_text_engine_manager()
        stt_manager = get_stt_engine_manager()

        # Check if at least one engine is enabled for each type
        has_tts_engine = any(
            settings_service.is_engine_enabled(name, 'tts')
            for name in tts_manager.list_all_engines()
        )
        has_text_engine = any(
            settings_service.is_engine_enabled(name, 'text')
            for name in text_manager.list_all_engines()
        )
        has_stt_engine = any(
            settings_service.is_engine_enabled(name, 'stt')
            for name in stt_manager.list_all_engines()
        )

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
        raise HTTPException(
            status_code=500,
            detail=f"[HEALTH_CHECK_FAILED]error:{str(e)}"
        )


@router.get("/", response_model=RootResponse)
async def root() -> RootResponse:
    """Root endpoint"""
    return RootResponse(
        name="Audiobook Maker API",
        version=__version__,
        status="online"
    )
