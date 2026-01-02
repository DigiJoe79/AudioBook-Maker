"""
Engine Status Broadcaster Service

Periodically broadcasts engine status updates via SSE to all connected clients.
Provides real-time engine status including auto-stop countdown timers.

Broadcasts every 15 seconds:
- Engine running status per type (TTS, Text, STT, Audio)
- secondsUntilAutoStop countdown for running engines
- hasTtsEngine, hasTextEngine, hasSttEngine flags
"""

import asyncio
from typing import Dict, Any, List
from loguru import logger

from services.event_broadcaster import emit_engine_status, safe_broadcast
from services.settings_service import SettingsService
from core.tts_engine_manager import get_tts_engine_manager
from core.text_engine_manager import get_text_engine_manager
from core.stt_engine_manager import get_stt_engine_manager
from core.audio_engine_manager import get_audio_engine_manager
from db.database import get_db_connection_simple


class EngineStatusBroadcaster:
    """
    Background service that periodically broadcasts engine status via SSE.

    Runs as background task, broadcasts every 15 seconds to all connected clients.
    Includes countdown timers for auto-stop feature.
    """

    def __init__(self):
        """Initialize engine status broadcaster"""
        self.running = False
        self.task: asyncio.Task | None = None
        self.interval_seconds = 15  # Broadcast every 15 seconds

        logger.debug("[EngineStatusBroadcaster] Initialized")

    def get_engine_status_for_type(
        self,
        manager,
        engine_type: str,
        settings_service
    ) -> List[Dict[str, Any]]:
        """
        Get status for all engines of a specific type.

        Args:
            manager: Engine manager instance (TTSEngineManager, etc.)
            engine_type: Type of engine ('tts', 'text', 'stt', 'audio')
            settings_service: Settings service for checking enabled status

        Returns:
            List of engine status dictionaries with:
            - variantId: Engine variant identifier (e.g., 'xtts:local')
            - isEnabled: Whether engine is enabled in settings
            - isRunning: Whether engine server is active
            - status: 'running', 'stopped', or 'disabled'
            - secondsUntilAutoStop: Countdown timer (None if not applicable)
            - port: HTTP port if running
        """
        engines_status = []

        # Note: list_all_engines() now returns variant_ids (e.g., 'xtts:local')
        # directly from the manager's tracking dictionaries
        for variant_id in manager.list_all_engines():
            is_enabled = settings_service.is_engine_enabled(variant_id, engine_type)
            is_running = manager.is_engine_running(variant_id)

            # Determine status string
            if not is_enabled:
                status = "disabled"
            elif is_running:
                status = "running"
            else:
                status = "stopped"

            # Get countdown timer
            seconds_until_auto_stop = None
            if is_running:
                seconds_until_auto_stop = manager.get_seconds_until_auto_stop(variant_id)

            engines_status.append({
                "variantId": variant_id,
                "isEnabled": is_enabled,
                "isRunning": is_running,
                "status": status,
                "secondsUntilAutoStop": seconds_until_auto_stop,
                "port": manager.engine_ports.get(variant_id),
            })

        return engines_status

    async def get_current_engine_status(self) -> Dict[str, Any]:
        """
        Get current status of all engines.

        Returns:
            Dictionary with:
            - engines: Dict with lists per type (tts, text, stt, audio)
            - hasTtsEngine: At least one TTS engine enabled
            - hasTextEngine: At least one Text engine enabled
            - hasSttEngine: At least one STT engine enabled
        """
        try:
            conn = get_db_connection_simple()
            settings_service = SettingsService(conn)

            # Get managers
            tts_manager = get_tts_engine_manager()
            text_manager = get_text_engine_manager()
            stt_manager = get_stt_engine_manager()
            audio_manager = get_audio_engine_manager()

            # Get status per type
            tts_status = self.get_engine_status_for_type(
                tts_manager, 'tts', settings_service
            )
            text_status = self.get_engine_status_for_type(
                text_manager, 'text', settings_service
            )
            stt_status = self.get_engine_status_for_type(
                stt_manager, 'stt', settings_service
            )
            audio_status = self.get_engine_status_for_type(
                audio_manager, 'audio', settings_service
            )

            # Calculate availability flags
            has_tts_engine = any(e['isEnabled'] for e in tts_status)
            has_text_engine = any(e['isEnabled'] for e in text_status)
            has_stt_engine = any(e['isEnabled'] for e in stt_status)
            has_audio_engine = any(e['isEnabled'] for e in audio_status)

            return {
                "engines": {
                    "tts": tts_status,
                    "text": text_status,
                    "stt": stt_status,
                    "audio": audio_status,
                },
                "hasTtsEngine": has_tts_engine,
                "hasTextEngine": has_text_engine,
                "hasSttEngine": has_stt_engine,
                "hasAudioEngine": has_audio_engine,
            }

        except Exception as e:
            logger.error(f"[EngineStatusBroadcaster] Failed to get engine status: {e}")
            return {
                "engines": {
                    "tts": [],
                    "text": [],
                    "stt": [],
                    "audio": [],
                },
                "hasTtsEngine": False,
                "hasTextEngine": False,
                "hasSttEngine": False,
                "hasAudioEngine": False,
            }

    async def broadcast_loop(self):
        """
        Main broadcast loop - runs continuously until stopped.
        Broadcasts engine status every N seconds.
        """
        while self.running:
            try:
                # Get current engine status
                status = await self.get_current_engine_status()

                # Broadcast to all SSE clients
                await emit_engine_status(
                    engines_status=status["engines"],
                    has_tts_engine=status["hasTtsEngine"],
                    has_text_engine=status["hasTextEngine"],
                    has_stt_engine=status["hasSttEngine"],
                    has_audio_engine=status["hasAudioEngine"],
                )

                logger.debug(
                    f"[EngineStatusBroadcaster] Broadcasted engine status "
                    f"(tts={status['hasTtsEngine']}, text={status['hasTextEngine']}, "
                    f"stt={status['hasSttEngine']}, audio={status['hasAudioEngine']})"
                )

                # Wait for next broadcast
                await asyncio.sleep(self.interval_seconds)

            except asyncio.CancelledError:
                # Task cancelled, exit gracefully
                logger.info("[EngineStatusBroadcaster] Task cancelled, stopping")
                break

            except Exception as e:
                logger.error(f"[EngineStatusBroadcaster] Error in broadcast loop: {e}")
                # Don't crash, just wait and retry
                await asyncio.sleep(self.interval_seconds)

        logger.info("[EngineStatusBroadcaster] Broadcast loop exited")

    async def start(self):
        """Start engine status broadcaster background task"""
        if self.running:
            logger.warning("[EngineStatusBroadcaster] Already running")
            return

        self.running = True
        self.task = asyncio.create_task(self.broadcast_loop())
        logger.debug(f"[EngineStatusBroadcaster] Started (interval: {self.interval_seconds}s)")

    async def stop(self):
        """Stop engine status broadcaster background task"""
        if not self.running:
            return

        logger.info("[EngineStatusBroadcaster] Stopping...")
        self.running = False

        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
            self.task = None

        logger.info("[EngineStatusBroadcaster] Stopped")

    async def broadcast_now(self):
        """
        Broadcast current engine status immediately.

        Use this for initial state on SSE connect or after engine changes.
        """
        status = await self.get_current_engine_status()
        await safe_broadcast(
            emit_engine_status,
            engines_status=status["engines"],
            has_tts_engine=status["hasTtsEngine"],
            has_text_engine=status["hasTextEngine"],
            has_stt_engine=status["hasSttEngine"],
            has_audio_engine=status["hasAudioEngine"],
            event_description="engine.status"
        )
        logger.debug("[EngineStatusBroadcaster] Immediate broadcast sent")


# Global singleton instance
engine_status_broadcaster = EngineStatusBroadcaster()
