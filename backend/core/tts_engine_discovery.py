"""
TTS Engine Discovery - TTS-specific engine scanning

Subclass of BaseEngineDiscovery for TTS engine discovery.
Currently uses base implementation without overrides.

Future: Can override _discover_engine() for TTS-specific validation
(e.g., checking for TTS-specific capabilities, model formats, etc.)

Example Usage:
    from pathlib import Path
    from loguru import logger

    discovery = TTSEngineDiscovery(Path("backend/engines/tts"))
    engines = discovery.discover_all()

    for name, metadata in engines.items():
        logger.info(f"Found TTS engine: {name}")
"""

from pathlib import Path
from .base_engine_discovery import BaseEngineDiscovery


class TTSEngineDiscovery(BaseEngineDiscovery):
    """
    TTS Engine Discovery

    Discovers TTS engines from engines/tts/ directory.
    Currently uses base implementation without TTS-specific overrides.

    Attributes:
        engines_base_path: Path to TTS engines directory (e.g., backend/engines/tts/)
        discovered_engines: Dictionary mapping engine_name -> engine_metadata
    """

    def __init__(self, engines_base_path: Path):
        """
        Initialize TTS engine discovery

        Args:
            engines_base_path: Path to TTS engines directory (e.g., backend/engines/tts/)
        """
        super().__init__(engines_base_path)
