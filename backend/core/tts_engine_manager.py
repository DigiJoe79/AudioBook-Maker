"""
TTS Engine Manager - TTS-specific engine management

Manages Text-to-Speech engine servers as separate processes.
Inherits common process management from BaseEngineManager.

This is the TTS-specific implementation that handles:
- TTS audio generation (generate_with_engine)
- TTS model management (get_available_models)
- Settings integration for allowed languages

Architecture:
    TTSEngineManager (extends BaseEngineManager)
    ├── TTS Audio Generation (generate_with_engine)
    ├── TTS Model Management (get_available_models)
    └── Language Filtering (get_engine_info with settings)

Usage:
    from backend.core.tts_engine_manager import get_tts_engine_manager

    manager = get_tts_engine_manager()

    # Ensure engine is ready
    await manager.ensure_engine_ready('xtts', 'v2.0.3')

    # Generate audio via HTTP
    audio_bytes = await manager.generate_with_engine(
        'xtts',
        text='Hello world',
        language='en',
        speaker_wav='/path/to/sample.wav',
        parameters={}
    )

Author: Multi-Engine Architecture Refactoring
Date: 2025-11-23
"""

from pathlib import Path
from typing import Dict, List, Optional, Any, Union
import httpx
from loguru import logger

from core.base_engine_manager import BaseEngineManager
from core.tts_engine_discovery import TTSEngineDiscovery


class TTSEngineManager(BaseEngineManager):
    """
    TTS Engine Manager - Manages TTS engine servers

    Extends BaseEngineManager with TTS-specific functionality:
    - Audio generation via HTTP (generate_with_engine)
    - TTS model queries (get_available_models)
    - Language filtering from settings

    Features:
    - Automatic engine discovery from engines/ directory
    - Process lifecycle management (start/stop servers)
    - HTTP client for engine communication
    - Health monitoring and auto-recovery
    - Language filtering based on user settings

    Attributes:
        Inherited from BaseEngineManager:
        - engine_type: 'tts'
        - engines_base_path: Path to engines/tts/ subdirectory
        - _engine_metadata: Discovered TTS engines
        - engine_processes: Running engine processes
        - engine_ports: Assigned ports
        - active_engine: Currently loaded engine
        - http_client: Async HTTP client
    """

    def __init__(self):
        """
        Initialize TTS Engine Manager

        Note: Use get_tts_engine_manager() instead of direct instantiation
        to ensure singleton pattern.
        """
        from config import BACKEND_ROOT

        # TTS engines are now in engines/tts/ subdirectory (Phase 2)
        engines_base_path = Path(BACKEND_ROOT) / 'engines' / 'tts'
        super().__init__(engines_base_path=engines_base_path, engine_type='tts')

    def _discover_engines(self) -> None:
        """
        Discover TTS engines from engines/tts/ directory

        Uses TTSEngineDiscovery to scan for engine servers.
        Populates self._engine_metadata dictionary.
        """
        try:
            discovery = TTSEngineDiscovery(self.engines_base_path)
            self._engine_metadata = discovery.discover_all()

            if not self._engine_metadata:
                logger.warning("No TTS engines discovered! Check engines/tts/ directory.")
            else:
                logger.debug(
                    f"Auto-discovered {len(self._engine_metadata)} TTS engines: "
                    f"{list(self._engine_metadata.keys())}"
                )
        except Exception as e:
            logger.error(f"TTS engine discovery failed: {e}")
            self._engine_metadata = {}

    def get_engine_info(self, engine_name: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Get metadata for all TTS engines or specific engine

        Overrides BaseEngineManager.get_engine_info() to add language filtering
        based on user settings (Settings → Languages → Allowed Languages).

        Args:
            engine_name: Specific engine to query, or None for all engines

        Returns:
            List of engine info dictionaries with metadata:
            - name: Engine identifier
            - display_name: Human-readable name
            - version: Engine version
            - capabilities: Feature flags
            - constraints: Limits
            - supported_languages: Filtered by allowed languages from settings
            - all_supported_languages: Unfiltered list (for Settings UI)
            - is_running: Whether engine server is active
            - port: HTTP port if running
        """
        # Get allowed languages from settings
        try:
            from services.settings_service import SettingsService
            from db.database import get_db_connection_simple

            conn = get_db_connection_simple()
            settings_service = SettingsService(conn)
            allowed_languages = settings_service.get_setting('languages.allowedLanguages') or ['de', 'en']
        except Exception as e:
            logger.warning(
                f"Could not load allowed languages from settings: {e}, using defaults"
            )
            allowed_languages = ['de', 'en']

        # Get base info from parent
        engine_names = [engine_name] if engine_name else self.list_available_engines()

        info_list = []
        for ename in engine_names:
            if ename not in self._engine_metadata:
                logger.warning(f"Unknown TTS engine: {ename}")
                continue

            metadata = self._engine_metadata[ename]

            # Filter supported languages based on allowed languages
            engine_languages = metadata.get('supported_languages', [])
            filtered_languages = list(set(engine_languages) & set(allowed_languages))

            info_list.append({
                'name': metadata.get('name', ename),
                'display_name': metadata.get('display_name', ename),
                'capabilities': metadata.get('capabilities', {}),
                'constraints': metadata.get('constraints', {}),
                'supported_languages': filtered_languages,
                'all_supported_languages': engine_languages,  # Unfiltered for Settings UI
                'is_running': ename in self.engine_processes,
                'port': self.engine_ports.get(ename)
            })

        return info_list

    def get_available_models(self, engine_name: str) -> List[Dict[str, Any]]:
        """
        Get list of available models for a specific TTS engine

        Args:
            engine_name: Engine identifier (e.g., 'xtts')

        Returns:
            List of model dictionaries with metadata:
            - tts_model_name: Model identifier
            - path: Path to model directory
            - display_name: Human-readable name
            - exists: Whether model files exist

        Raises:
            ValueError: If engine_name is unknown
        """
        if engine_name not in self._engine_metadata:
            available = ', '.join(self._engine_metadata.keys())
            raise ValueError(
                f"Unknown TTS engine: '{engine_name}'. "
                f"Available engines: {available}"
            )

        metadata = self._engine_metadata[engine_name]
        return metadata.get('models', [])

    async def generate_with_engine(
        self,
        engine_name: str,
        text: str,
        language: str,
        speaker_wav: Union[str, List[str]],
        parameters: Dict[str, Any]
    ) -> bytes:
        """
        Call TTS engine's /generate endpoint to synthesize audio

        Args:
            engine_name: Engine identifier (e.g., 'xtts')
            text: Text to synthesize
            language: Language code (e.g., 'en', 'de')
            speaker_wav: Path(s) to speaker sample audio file(s)
            parameters: Engine-specific generation parameters

        Returns:
            WAV audio as bytes

        Raises:
            RuntimeError: If engine not running or generation fails
        """
        port = self.engine_ports.get(engine_name)
        if not port:
            raise RuntimeError(f"TTS engine {engine_name} not running")

        url = f"http://127.0.0.1:{port}/generate"

        payload = {
            "text": text,
            "language": language,
            "ttsSpeakerWav": speaker_wav,
            "parameters": parameters
        }

        logger.debug(f"Generating audio with {engine_name}: {text[:50]}...")

        try:
            response = await self.http_client.post(url, json=payload)
            response.raise_for_status()
        except httpx.RequestError as e:
            raise RuntimeError(f"HTTP request to {engine_name} failed: {e}")
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"Engine {engine_name} returned error {e.response.status_code}: {e.response.text[:200]}")

        audio_bytes = response.content
        logger.debug(f"Generated {len(audio_bytes)} bytes")

        # Record activity for auto-stop tracking
        self.record_activity(engine_name)

        return audio_bytes

    def rediscover_engines(self) -> Dict[str, Any]:
        """
        Re-discover TTS engines from engines/tts/ directory (Hot-Reload)

        Use Case: User installs new TTS engine while backend is running

        Returns:
            Dictionary of newly discovered engines
        """
        logger.info("Re-discovering TTS engines...")

        try:
            discovery = TTSEngineDiscovery(self.engines_base_path)
            new_engines = discovery.discover_all()

            # Update metadata
            self._engine_metadata.update(new_engines)

            logger.info(
                f"Re-discovered {len(new_engines)} TTS engines: {list(new_engines.keys())}"
            )

            return new_engines
        except Exception as e:
            logger.error(f"TTS engine re-discovery failed: {e}")
            return {}


# ==================== Singleton Factory ====================

_tts_engine_manager: Optional[TTSEngineManager] = None


def get_tts_engine_manager() -> TTSEngineManager:
    """
    Get or create the global TTSEngineManager singleton instance

    This is the recommended way to access the TTSEngineManager.
    Ensures only one manager instance exists across the application.

    Returns:
        TTSEngineManager singleton instance

    Example:
        from backend.core.tts_engine_manager import get_tts_engine_manager

        manager = get_tts_engine_manager()
        engines = manager.list_available_engines()
    """
    global _tts_engine_manager

    if _tts_engine_manager is None:
        _tts_engine_manager = TTSEngineManager()

    return _tts_engine_manager


async def reset_tts_engine_manager() -> None:
    """
    Reset the TTSEngineManager singleton (for testing)

    WARNING: This will stop all engines and reset the manager.
    Only use in test scenarios or explicit cleanup.
    """
    global _tts_engine_manager

    if _tts_engine_manager is not None:
        await _tts_engine_manager.cleanup()
        _tts_engine_manager = None
        logger.info("TTSEngineManager singleton reset")


