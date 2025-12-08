"""
STT Engine Manager - STT-specific engine management

Manages Speech-to-Text engine servers as separate processes.
Inherits common process management from BaseEngineManager.

This is the STT-specific implementation that handles:
- STT transcription (transcribe_with_engine)
- Generic quality analysis (analyze_generic) - for QualityWorker
- Model management (get_available_models)

Architecture:
    STTEngineManager (extends BaseEngineManager)
    ├── STT Transcription (transcribe_with_engine)
    ├── Generic Quality Analysis (analyze_generic)
    └── STT Model Management (get_available_models)

Usage:
    from backend.core.stt_engine_manager import get_stt_engine_manager

    manager = get_stt_engine_manager()

    # Ensure engine is ready
    await manager.ensure_engine_ready('whisper', 'base')

    # Generic analysis for quality system
    result = await manager.analyze_generic(
        'whisper',
        audio_path='/path/to/audio.wav',
        language='en'
    )

Author: Multi-Engine Architecture Refactoring
Date: 2025-11-23
"""

from pathlib import Path
from typing import Dict, Optional, Any, List
import httpx
from loguru import logger

from core.base_engine_manager import BaseEngineManager
from core.stt_engine_discovery import STTEngineDiscovery


class STTEngineManager(BaseEngineManager):
    """
    STT Engine Manager - Manages STT engine servers

    Extends BaseEngineManager with STT-specific functionality:
    - Audio transcription via HTTP (transcribe_with_engine)
    - Generic quality analysis (analyze_generic) - for QualityWorker
    - STT model queries (get_available_models)

    Features:
    - Automatic engine discovery from engines/stt/ directory
    - Process lifecycle management (start/stop servers)
    - HTTP client for engine communication
    - Health monitoring and auto-recovery

    Attributes:
        Inherited from BaseEngineManager:
        - engine_type: 'stt'
        - engines_base_path: Path to engines/stt/ subdirectory
        - _engine_metadata: Discovered STT engines
        - engine_processes: Running engine processes
        - engine_ports: Assigned ports
        - active_engine: Currently loaded engine
        - http_client: Async HTTP client
    """

    def __init__(self):
        """
        Initialize STT Engine Manager

        Note: Use get_stt_engine_manager() instead of direct instantiation
        to ensure singleton pattern.
        """
        from config import BACKEND_ROOT

        # STT engines are in engines/stt/ subdirectory (Phase 6)
        engines_base_path = Path(BACKEND_ROOT) / 'engines' / 'stt'
        super().__init__(engines_base_path=engines_base_path, engine_type='stt')

    def _discover_engines(self) -> None:
        """
        Discover STT engines from engines/stt/ directory

        Uses STTEngineDiscovery to scan for engine servers.
        Populates self._engine_metadata dictionary.
        """
        try:
            discovery = STTEngineDiscovery(self.engines_base_path)
            self._engine_metadata = discovery.discover_all()

            if not self._engine_metadata:
                logger.warning("No STT engines discovered! Check engines/stt/ directory.")
            else:
                logger.debug(
                    f"Auto-discovered {len(self._engine_metadata)} STT engines: "
                    f"{list(self._engine_metadata.keys())}"
                )
        except Exception as e:
            logger.error(f"STT engine discovery failed: {e}")
            self._engine_metadata = {}

    def get_available_models(self, engine_name: str) -> list[Dict[str, Any]]:
        """
        Get list of available models for a specific STT engine

        Args:
            engine_name: Engine identifier (e.g., 'whisper')

        Returns:
            List of model dictionaries with metadata:
            - engine_model_name: Model identifier
            - path: Path to model directory
            - display_name: Human-readable name
            - exists: Whether model files exist

        Raises:
            ValueError: If engine_name is unknown
        """
        if engine_name not in self._engine_metadata:
            available = ', '.join(self._engine_metadata.keys())
            raise ValueError(
                f"Unknown STT engine: '{engine_name}'. "
                f"Available engines: {available}"
            )

        metadata = self._engine_metadata[engine_name]
        return metadata.get('models', [])

    async def transcribe_with_engine(
        self,
        engine_name: str,
        audio_path: str,
        language: str,
        parameters: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Call STT engine's /transcribe endpoint to transcribe audio

        Args:
            engine_name: Engine identifier (e.g., 'whisper')
            audio_path: Path to audio file to transcribe
            language: Language code (e.g., 'en', 'de')
            parameters: Engine-specific transcription parameters

        Returns:
            Transcription result dictionary:
            - text: Transcribed text
            - confidence: Overall confidence score (0-100)
            - segments: List of segment dictionaries
            - language: Detected/confirmed language

        Raises:
            RuntimeError: If engine not running or transcription fails
        """
        port = self.engine_ports.get(engine_name)
        if not port:
            raise RuntimeError(f"STT engine {engine_name} not running")

        url = f"http://127.0.0.1:{port}/transcribe"

        payload = {
            "audioPath": audio_path,
            "language": language,
            "parameters": parameters
        }

        logger.debug(f"Transcribing audio with {engine_name}: {audio_path}")

        try:
            response = await self.http_client.post(url, json=payload)
            response.raise_for_status()
        except httpx.RequestError as e:
            raise RuntimeError(f"HTTP request to {engine_name} failed: {e}")
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"Engine {engine_name} returned error {e.response.status_code}: {e.response.text[:200]}")

        try:
            result = response.json()
        except ValueError as e:
            raise RuntimeError(f"Invalid JSON response from {engine_name}: {e}")

        logger.debug(
            f"Transcription completed: {len(result.get('text', ''))} characters, "
            f"confidence {result.get('confidence', 0):.1f}%"
        )

        return result

    async def analyze_generic(
        self,
        engine_name: str,
        audio_path: str,
        language: str,
        model_name: Optional[str] = None,
        expected_text: Optional[str] = None,
        pronunciation_rules: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        Analyze audio and return result in generic quality format.

        Calls the engine's /analyze endpoint which returns
        the unified quality format (engineType, engineName, qualityScore,
        qualityStatus, details).

        Args:
            engine_name: Name of the STT engine
            audio_path: Path to audio file
            language: Language code
            model_name: Optional model name
            expected_text: Original segment text for comparison
            pronunciation_rules: Active pronunciation rules to filter false positives

        Returns:
            Dict with generic quality format:
            {
                'engineType': 'stt',
                'engineName': 'whisper',
                'qualityScore': 85,
                'qualityStatus': 'perfect',
                'details': {
                    'topLabel': 'whisperAnalysis',
                    'fields': [...],
                    'infoBlocks': {...}
                }
            }
        """
        import base64

        # Ensure engine is ready
        await self.ensure_engine_ready(engine_name, model_name)

        # Get engine port
        port = self.engine_ports.get(engine_name)
        if not port:
            raise RuntimeError(f"Engine {engine_name} not running")

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
            "audioBase64": audio_base64,
            "language": language
        }

        # Add STT-specific parameters for text comparison
        if expected_text:
            payload["expectedText"] = expected_text
        if pronunciation_rules:
            payload["pronunciationRules"] = pronunciation_rules

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

_stt_engine_manager: Optional[STTEngineManager] = None


def get_stt_engine_manager() -> STTEngineManager:
    """
    Get or create the global STTEngineManager singleton instance

    This is the recommended way to access the STTEngineManager.
    Ensures only one manager instance exists across the application.

    Returns:
        STTEngineManager singleton instance

    Example:
        from backend.core.stt_engine_manager import get_stt_engine_manager

        manager = get_stt_engine_manager()
        engines = manager.list_available_engines()
    """
    global _stt_engine_manager

    if _stt_engine_manager is None:
        _stt_engine_manager = STTEngineManager()

    return _stt_engine_manager


async def reset_stt_engine_manager() -> None:
    """
    Reset the STTEngineManager singleton (for testing)

    WARNING: This will stop all engines and reset the manager.
    Only use in test scenarios or explicit cleanup.
    """
    global _stt_engine_manager

    if _stt_engine_manager is not None:
        await _stt_engine_manager.cleanup()
        _stt_engine_manager = None
        logger.info("STTEngineManager singleton reset")
