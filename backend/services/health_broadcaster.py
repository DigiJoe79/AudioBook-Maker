"""
Health Broadcaster Service

Periodically broadcasts system health updates via SSE to all connected clients.
Provides real-time health information without requiring polling.
"""

import asyncio
from typing import Dict, Any
from loguru import logger

from services.event_broadcaster import broadcaster
from core.tts_worker import get_tts_worker
from core.engine_manager import get_engine_manager
from db.repositories import TTSJobRepository
from db.database import get_db_connection_simple
from models.response_models import HealthResponse
from version import __version__
from datetime import datetime


class HealthBroadcaster:
    """
    Background service that periodically broadcasts health updates via SSE.

    Runs as background task, independent of TTS Worker.
    Broadcasts health updates every 5 seconds to all connected SSE clients.
    """

    def __init__(self):
        """Initialize health broadcaster"""
        self.running = False
        self.task: asyncio.Task | None = None
        self.interval_seconds = 5  # Broadcast every 5 seconds

        logger.debug("[HealthBroadcaster] Initialized")

    async def get_current_health(self) -> Dict[str, Any]:
        """
        Get current system health information.

        Returns:
            Health data dict (camelCase) ready for SSE broadcasting

        IMPORTANT: Uses HealthResponse Pydantic model for consistent formatting.
        Returns dict with camelCase keys via model_dump(by_alias=True).
        """
        try:
            # Get active jobs count from database
            conn = get_db_connection_simple()
            job_repo = TTSJobRepository(conn)
            active_jobs_count = job_repo.count_active_jobs()

            # Get TTS worker status
            worker = get_tts_worker()
            busy = (worker.current_job_id is not None) if worker else False

            # Get available engines
            manager = get_engine_manager()
            available_engines = manager.list_available_engines()

            # Create HealthResponse model (use snake_case field names)
            health_response = HealthResponse(
                status="ok",
                version=__version__,
                timestamp=datetime.utcnow().isoformat(),
                database=True,  # We successfully queried DB
                tts_engines=available_engines,
                busy=busy,
                active_jobs=active_jobs_count
            )

            # Serialize to dict with camelCase keys (by_alias=True)
            # This automatically converts: tts_engines → ttsEngines, active_jobs → activeJobs
            health_data = health_response.model_dump(by_alias=True)

            return health_data

        except Exception as e:
            logger.error(f"[HealthBroadcaster] Failed to get health: {e}")

            # Error response also uses HealthResponse model
            error_response = HealthResponse(
                status="error",
                version=__version__,
                timestamp=datetime.utcnow().isoformat(),
                database=False,
                tts_engines=[],
                busy=False,
                active_jobs=0
            )

            return error_response.model_dump(by_alias=True)

    async def broadcast_loop(self):
        """
        Main broadcast loop - runs continuously until stopped.
        Broadcasts health updates every N seconds.
        """
        while self.running:
            try:
                # Get current health
                health_data = await self.get_current_health()

                # Broadcast to all SSE clients on 'health' channel
                await broadcaster.broadcast_health_update(health_data)

                # Log at debug level (don't spam logs)
                logger.debug(
                    f"[HealthBroadcaster] Broadcasted health update "
                    f"(busy={health_data['busy']}, activeJobs={health_data['activeJobs']})"
                )

                # Wait for next broadcast
                await asyncio.sleep(self.interval_seconds)

            except asyncio.CancelledError:
                # Task cancelled, exit gracefully
                logger.info("[HealthBroadcaster] Task cancelled, stopping")
                break

            except Exception as e:
                logger.error(f"[HealthBroadcaster] Error in broadcast loop: {e}")
                # Don't crash, just wait and retry
                await asyncio.sleep(self.interval_seconds)

        logger.info("[HealthBroadcaster] Broadcast loop exited")

    async def start(self):
        """Start health broadcaster background task"""
        if self.running:
            logger.warning("[HealthBroadcaster] Already running")
            return

        self.running = True
        self.task = asyncio.create_task(self.broadcast_loop())

    async def stop(self):
        """Stop health broadcaster background task"""
        if not self.running:
            return

        logger.info("[HealthBroadcaster] Stopping...")
        self.running = False

        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
            self.task = None

        logger.info("[HealthBroadcaster] Stopped")


# Global singleton instance
health_broadcaster = HealthBroadcaster()
