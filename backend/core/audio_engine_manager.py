"""
Audio Engine Manager - Audio analysis engine management

Manages audio analysis engine servers as separate processes.
Inherits common process management from BaseEngineManager.

This is the audio analysis-specific implementation that handles:
- Audio quality analysis (analyze_with_engine)
- Speech ratio detection
- Silence/noise analysis
- Custom quality metrics

Architecture:
    AudioEngineManager (extends BaseEngineManager)
    ├── Audio Analysis (analyze_with_engine)
    ├── Quality Metrics (speech_ratio, silence_ratio, noise_level)
    └── Custom Analysis Parameters

Usage:
    from backend.core.audio_engine_manager import get_audio_engine_manager

    manager = get_audio_engine_manager()

    # Ensure engine is ready
    await manager.ensure_engine_ready('basic_analyzer', 'v1.0.0')

    # Analyze audio quality via HTTP
    metrics = await manager.analyze_with_engine(
        'basic_analyzer',
        audio_path='/path/to/audio.wav',
        parameters={'threshold': 0.5}
    )

Author: Multi-Engine Architecture Refactoring (Phase 7)
Date: 2025-11-23
"""

from pathlib import Path
from typing import Dict, Optional, Any
import httpx
from loguru import logger

from core.base_engine_manager import BaseEngineManager
from core.audio_engine_discovery import AudioEngineDiscovery
from config import BACKEND_ROOT


class AudioEngineManager(BaseEngineManager):
    """
    Audio Engine Manager - Manages audio analysis engine servers

    Extends BaseEngineManager with audio analysis-specific functionality:
    - Audio quality analysis via HTTP (analyze_with_engine)
    - Speech ratio detection
    - Silence/noise analysis
    - Custom quality metrics

    Features:
    - Automatic engine discovery from engines/audio_analysis/ directory
    - Process lifecycle management (start/stop servers)
    - HTTP client for engine communication
    - Health monitoring and auto-recovery

    Attributes:
        Inherited from BaseEngineManager:
        - engine_type: 'audio'
        - engines_base_path: Path to engines/audio_analysis/ subdirectory
        - _engine_metadata: Discovered audio engines
        - engine_processes: Running engine processes
        - engine_ports: Assigned ports
        - active_engine: Currently loaded engine
        - http_client: Async HTTP client
    """

    def __init__(self):
        """
        Initialize Audio Engine Manager

        Note: Use get_audio_engine_manager() instead of direct instantiation
        to ensure singleton pattern.
        """
        # Audio analysis engines are in engines/audio_analysis/ subdirectory
        engines_base_path = Path(BACKEND_ROOT) / 'engines' / 'audio_analysis'
        super().__init__(engines_base_path=engines_base_path, engine_type='audio')

    def _discover_engines(self) -> None:
        """
        Discover audio analysis engines from engines/audio_analysis/ directory

        Uses AudioEngineDiscovery to scan for engine servers.
        Populates self._engine_metadata dictionary.
        """
        try:
            discovery = AudioEngineDiscovery(self.engines_base_path)
            self._engine_metadata = discovery.discover_all()

            if not self._engine_metadata:
                logger.warning(
                    "No audio analysis engines discovered! "
                    "Check engines/audio_analysis/ directory."
                )
            else:
                logger.info(
                    f"Auto-discovered {len(self._engine_metadata)} audio analysis engines: "
                    f"{list(self._engine_metadata.keys())}"
                )
        except Exception as e:
            logger.error(f"Audio engine discovery failed: {e}")
            self._engine_metadata = {}

    async def analyze_with_engine(
        self,
        engine_name: str,
        audio_path: str,
        parameters: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Call audio engine's /analyze endpoint for quality analysis

        Args:
            engine_name: Engine identifier (e.g., 'basic_analyzer')
            audio_path: Path to audio file to analyze
            parameters: Engine-specific analysis parameters (optional)

        Returns:
            Dictionary containing audio quality metrics:
            - speech_ratio: Percentage of speech content (0.0-1.0)
            - silence_ratio: Percentage of silence (0.0-1.0)
            - noise_level: Noise level (0.0-1.0)
            - clarity_score: Overall clarity score (0.0-1.0)
            - duration: Audio duration in seconds
            - sample_rate: Audio sample rate (Hz)
            - custom metrics: Engine-specific additional metrics

        Raises:
            RuntimeError: If engine not running or analysis fails
            ValueError: If audio file not found or invalid
        """
        port = self.engine_ports.get(engine_name)
        if not port:
            raise RuntimeError(f"Audio engine {engine_name} not running")

        url = f"http://127.0.0.1:{port}/analyze"

        payload = {
            "audioPath": audio_path,
            "parameters": parameters or {}
        }

        logger.debug(f"Analyzing audio with {engine_name}: {audio_path}")

        try:
            response = await self.http_client.post(url, json=payload)
            response.raise_for_status()
        except httpx.RequestError as e:
            raise RuntimeError(f"HTTP request to {engine_name} failed: {e}")
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"Engine {engine_name} returned error {e.response.status_code}: {e.response.text[:200]}")

        try:
            metrics = response.json()
        except ValueError as e:
            raise RuntimeError(f"Invalid JSON response from {engine_name}: {e}")

        logger.debug(
            f"Analysis complete: speech={metrics.get('speechRatio'):.2%}, "
            f"silence={metrics.get('silenceRatio'):.2%}"
        )

        return metrics

    async def analyze_generic(
        self,
        engine_name: str,
        audio_path: str,
        thresholds: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Analyze audio quality and return result in generic format.

        Calls the engine's /analyze endpoint which returns
        the unified quality format.

        Args:
            engine_name: Name of the audio engine
            audio_path: Path to audio file
            thresholds: Optional quality thresholds

        Returns:
            Dict with generic quality format:
            {
                'engineType': 'audio',
                'engineName': 'silero-vad',
                'qualityScore': 85,
                'qualityStatus': 'perfect',
                'details': {
                    'topLabel': 'audioQuality',
                    'fields': [...],
                    'infoBlocks': {...}
                }
            }
        """
        import base64

        # Get engine port (assume engine is already started by caller via ensure_engine_ready)
        port = self.engine_ports.get(engine_name)
        if not port:
            raise RuntimeError(f"Engine {engine_name} not running - call ensure_engine_ready first")

        # Read and encode audio
        try:
            with open(audio_path, 'rb') as f:
                audio_base64 = base64.b64encode(f.read()).decode('utf-8')
        except FileNotFoundError:
            raise ValueError(f"Audio file not found: {audio_path}")
        except IOError as e:
            raise RuntimeError(f"Failed to read audio file: {e}")

        # Call engine's analyze endpoint
        url = f"http://127.0.0.1:{port}/analyze"
        payload = {
            "audio_base64": audio_base64,
        }
        if thresholds:
            payload["quality_thresholds"] = thresholds

        from config import ENGINE_ANALYSIS_TIMEOUT
        try:
            response = await self.http_client.post(url, json=payload, timeout=float(ENGINE_ANALYSIS_TIMEOUT))
            response.raise_for_status()
        except httpx.RequestError as e:
            raise RuntimeError(f"HTTP request to {engine_name} failed: {e}")
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"Engine {engine_name} returned error {e.response.status_code}: {e.response.text[:200]}")

        try:
            result = response.json()
        except ValueError as e:
            raise RuntimeError(f"Invalid JSON response from {engine_name}: {e}")

        # Record activity for auto-stop tracking
        self.record_activity(engine_name)

        return result


# ==================== Singleton Factory ====================

_audio_engine_manager: Optional[AudioEngineManager] = None


def get_audio_engine_manager() -> AudioEngineManager:
    """
    Get or create the global AudioEngineManager singleton instance

    This is the recommended way to access the AudioEngineManager.
    Ensures only one manager instance exists across the application.

    Returns:
        AudioEngineManager singleton instance

    Example:
        from backend.core.audio_engine_manager import get_audio_engine_manager

        manager = get_audio_engine_manager()
        engines = manager.list_available_engines()
    """
    global _audio_engine_manager

    if _audio_engine_manager is None:
        _audio_engine_manager = AudioEngineManager()

    return _audio_engine_manager


async def reset_audio_engine_manager() -> None:
    """
    Reset the AudioEngineManager singleton (for testing)

    WARNING: This will stop all engines and reset the manager.
    Only use in test scenarios or explicit cleanup.
    """
    global _audio_engine_manager

    if _audio_engine_manager is not None:
        await _audio_engine_manager.cleanup()
        _audio_engine_manager = None
        logger.info("AudioEngineManager singleton reset")
