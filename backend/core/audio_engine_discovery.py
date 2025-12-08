"""
Audio Engine Discovery - Audio analysis engine scanning

Simple subclass of BaseEngineDiscovery for audio analysis engines.
No special validation needed beyond base class functionality.

Audio engines provide quality analysis capabilities:
- Speech ratio analysis
- Silence/noise detection
- Audio clarity metrics
- Custom quality checks

Author: Multi-Engine Architecture Refactoring (Phase 7)
Date: 2025-11-23
"""

from pathlib import Path
from core.base_engine_discovery import BaseEngineDiscovery


class AudioEngineDiscovery(BaseEngineDiscovery):
    """
    Audio Engine Discovery - Discovers audio analysis engines

    Simple subclass of BaseEngineDiscovery with no audio-specific overrides.
    All discovery logic is inherited from the base class:
    - Scanning engines/audio_analysis/ directory
    - Parsing engine.yaml files
    - Validating server.py and venv/
    - Auto-detecting models (if applicable)

    Usage:
        discovery = AudioEngineDiscovery(Path('backend/engines/audio_analysis'))
        engines = discovery.discover_all()

    Example Directory Structure:
        engines/audio_analysis/
        ├── basic_analyzer/
        │   ├── server.py
        │   ├── engine.yaml
        │   └── venv/
        └── advanced_analyzer/
            ├── server.py
            ├── engine.yaml
            └── venv/
    """

    def __init__(self, engines_base_path: Path):
        """
        Initialize audio engine discovery

        Args:
            engines_base_path: Path to audio analysis engines directory
                              (e.g., backend/engines/audio_analysis/)
        """
        super().__init__(engines_base_path)
