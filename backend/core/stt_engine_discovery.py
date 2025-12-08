"""
STT Engine Discovery - STT-specific engine scanning

Simple subclass of BaseEngineDiscovery for STT engines.
No method overrides needed - inherits all discovery logic.

This class exists primarily for type clarity and potential future
STT-specific validation if needed.

Usage:
    from backend.core.stt_engine_discovery import STTEngineDiscovery

    discovery = STTEngineDiscovery(Path('backend/engines/stt'))
    engines = discovery.discover_all()

Author: Multi-Engine Architecture Refactoring
Date: 2025-11-23
"""

from core.base_engine_discovery import BaseEngineDiscovery


class STTEngineDiscovery(BaseEngineDiscovery):
    """
    STT Engine Discovery - Discover STT engines from engines/stt/ directory

    Simple subclass of BaseEngineDiscovery with no overrides.
    Inherits all discovery logic from parent class.

    Future enhancements could add STT-specific validation here
    (e.g., checking for required STT capabilities).
    """
    pass
