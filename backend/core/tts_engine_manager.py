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
from typing import Dict, List, Optional, Any, Union, Tuple
import httpx
from loguru import logger

from core.base_engine_manager import BaseEngineManager
from core.tts_engine_discovery import TTSEngineDiscovery
from core.engine_exceptions import EngineClientError, EngineLoadingError, EngineServerError


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
        - engine_endpoints: Running engine endpoints (subprocess and Docker)
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

    def discover_local_engines(self) -> Dict[str, Dict[str, Any]]:
        """
        Discover TTS engines from engines/tts/ directory

        Uses TTSEngineDiscovery to scan for engine servers.
        Returns discovered engine metadata directly.

        Returns:
            Dictionary mapping engine_name -> engine_metadata
        """
        try:
            discovery = TTSEngineDiscovery(self.engines_base_path)
            discovered = discovery.discover_all()

            if not discovered:
                logger.info("No local TTS engines found (subprocess)")
            else:
                logger.debug(
                    f"Auto-discovered {len(discovered)} subprocess TTS engines: "
                    f"{list(discovered.keys())}"
                )
            return discovered
        except Exception as e:
            logger.error(f"TTS engine discovery failed: {e}")
            return {}

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
            # Parse variant ID to get base engine name (e.g., 'xtts:local' -> 'xtts')
            from core.base_engine_manager import parse_variant_id
            base_name, runner_id = parse_variant_id(ename)

            # Get metadata from DB (Single Source of Truth)
            metadata = self.get_engine_metadata(ename)

            if not metadata:
                logger.warning(f"Unknown TTS engine: {ename}")
                continue

            # Filter supported languages based on allowed languages
            engine_languages = metadata.get('supported_languages', [])
            filtered_languages = list(set(engine_languages) & set(allowed_languages))

            info_list.append({
                'name': metadata.get('name') or base_name,
                'display_name': metadata.get('display_name') or base_name,
                'capabilities': metadata.get('capabilities') or {},
                'constraints': metadata.get('constraints') or {},
                'supported_languages': filtered_languages,
                'all_supported_languages': engine_languages,  # Unfiltered for Settings UI
                'is_running': self.is_engine_running(ename),
                'port': self.engine_ports.get(ename)
            })

        return info_list

    def get_available_models(self, engine_name: str) -> List[Dict[str, Any]]:
        """
        Get list of available models for a specific TTS engine

        Args:
            engine_name: Engine identifier (e.g., 'xtts' or 'xtts:local')

        Returns:
            List of model dictionaries with metadata:
            - tts_model_name: Model identifier
            - path: Path to model directory
            - display_name: Human-readable name
            - exists: Whether model files exist

        Raises:
            ValueError: If engine_name is unknown
        """
        # Parse variant ID to get base engine name (e.g., 'xtts:local' -> 'xtts')
        from core.base_engine_manager import parse_variant_id
        base_name, _ = parse_variant_id(engine_name)

        # Get metadata from DB (Single Source of Truth)
        metadata = self.get_engine_metadata(engine_name)
        if not metadata:
            available = ', '.join(self.list_installed_engines())
            raise ValueError(
                f"Unknown TTS engine: '{engine_name}'. "
                f"Available engines: {available}"
            )

        return metadata.get('models', [])

    async def ensure_samples_available(
        self,
        engine_name: str,
        sample_files: List[Tuple[str, Path]]
    ) -> List[str]:
        """
        Ensure speaker samples are available in the engine.

        Checks which samples exist in the engine and uploads missing ones.
        This replaces the old path transformation approach and works with
        both local subprocess and remote Docker engines.

        Args:
            engine_name: Target engine variant_id (e.g., 'xtts:local', 'xtts:docker')
            sample_files: List of (sample_uuid, host_path) tuples where:
                - sample_uuid: UUID of the sample (without .wav extension)
                - host_path: Full path to sample file on host

        Returns:
            List of sample filenames for use in generate request
            (e.g., ["uuid1.wav", "uuid2.wav"])

        Raises:
            RuntimeError: If engine not running or sample operations fail
        """
        if not sample_files:
            return []

        base_url = self.get_engine_base_url(engine_name)

        # 1. Check which samples exist in the engine
        sample_ids = [uuid for uuid, _ in sample_files]

        try:
            response = await self.http_client.post(
                f"{base_url}/samples/check",
                json={"sampleIds": sample_ids}
            )
            response.raise_for_status()
            check_result = response.json()
            missing = set(check_result.get("missing", []))
        except httpx.RequestError as e:
            raise RuntimeError(f"Failed to check samples on {engine_name}: {e}")
        except httpx.HTTPStatusError as e:
            raise RuntimeError(
                f"Sample check failed on {engine_name}: "
                f"{e.response.status_code} - {e.response.text[:200]}"
            )

        # 2. Upload missing samples
        if missing:
            logger.debug(
                f"Uploading {len(missing)} missing samples to {engine_name}"
            )

            for sample_uuid, host_path in sample_files:
                if sample_uuid in missing:
                    try:
                        with open(host_path, "rb") as f:
                            wav_bytes = f.read()
                            upload_response = await self.http_client.post(
                                f"{base_url}/samples/upload/{sample_uuid}",
                                content=wav_bytes,
                                headers={"Content-Type": "audio/wav"}
                            )
                            upload_response.raise_for_status()
                            logger.debug(f"Uploaded sample {sample_uuid} to {engine_name}")
                    except FileNotFoundError:
                        raise RuntimeError(f"Sample file not found: {host_path}")
                    except httpx.RequestError as e:
                        raise RuntimeError(
                            f"Failed to upload sample {sample_uuid} to {engine_name}: {e}"
                        )
                    except httpx.HTTPStatusError as e:
                        raise RuntimeError(
                            f"Sample upload failed on {engine_name}: "
                            f"{e.response.status_code} - {e.response.text[:200]}"
                        )
        else:
            logger.debug(f"All {len(sample_ids)} samples already exist in {engine_name}")

        # 3. Return filenames for generate request
        return [f"{uuid}.wav" for uuid, _ in sample_files]

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
            engine_name: Engine variant_id (e.g., 'xtts:local', 'xtts:docker')
            text: Text to synthesize
            language: Language code (e.g., 'en', 'de')
            speaker_wav: Filename(s) of speaker sample(s) in engine's samples_dir
                         (e.g., "uuid.wav" or ["uuid1.wav", "uuid2.wav"])
            parameters: Engine-specific generation parameters

        Returns:
            WAV audio as bytes

        Raises:
            RuntimeError: If engine not running or generation fails
        """
        try:
            base_url = self.get_engine_base_url(engine_name)
        except RuntimeError:
            raise RuntimeError(f"TTS engine {engine_name} not running")

        url = f"{base_url}/generate"

        # speaker_wav is now a filename (e.g., "uuid.wav") - no transformation needed
        # The engine server resolves filenames to full paths in its samples_dir

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
            raise EngineServerError(f"HTTP request to {engine_name} failed: {e}")
        except httpx.HTTPStatusError as e:
            status_code = e.response.status_code
            detail = e.response.text[:200]

            if status_code in (400, 404):
                # Client error - request is invalid, don't retry
                raise EngineClientError(f"{engine_name} rejected request ({status_code}): {detail}")
            elif status_code == 503:
                # Engine loading - retry without restart
                raise EngineLoadingError(f"{engine_name} is loading: {detail}")
            else:
                # Server error (500, etc.) - restart and retry
                raise EngineServerError(f"{engine_name} error ({status_code}): {detail}")

        audio_bytes = response.content
        logger.debug(f"Generated {len(audio_bytes)} bytes")

        # Record activity for auto-stop tracking
        self.record_activity(engine_name)

        return audio_bytes


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


