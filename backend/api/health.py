"""
Health check endpoints
"""

from fastapi import APIRouter
from models.response_models import HealthResponse, RootResponse
from services.health_monitor import get_health_monitor
from services.tts_manager import get_tts_manager
from version import __version__

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """
    Health check endpoint - responds immediately even during heavy operations.

    Uses a separate monitoring thread to ensure non-blocking responses,
    preventing false "connection lost" warnings during TTS model loading.
    """
    monitor = get_health_monitor()
    status = monitor.get_status()

    tts_manager = get_tts_manager()
    engines = tts_manager.list_available_engines()

    return {
        "status": status["status"],
        "version": __version__,
        "timestamp": status["timestamp"],
        "database": status["database"],
        "tts_engines": engines,
        "busy": status["busy"],
        "active_jobs": status["active_jobs"]
    }


@router.get("/", response_model=RootResponse)
async def root():
    """Root endpoint"""
    return {
        "name": "Audiobook Maker API",
        "version": __version__,
        "status": "online"
    }
