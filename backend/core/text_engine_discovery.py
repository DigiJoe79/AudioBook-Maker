"""
Text Engine Discovery - Text processing engine scanning

Simple subclass of BaseEngineDiscovery for text processing engines.
No type-specific validation needed - uses base discovery logic.

Text processing engines are located in:
    backend/engines/text_processing/

Author: Multi-Engine Architecture Refactoring
Date: 2025-11-23
"""

from core.base_engine_discovery import BaseEngineDiscovery


class TextEngineDiscovery(BaseEngineDiscovery):
    """
    Text Engine Discovery - Scans for text processing engine servers

    Inherits all discovery logic from BaseEngineDiscovery.
    No method overrides needed - text engines use standard structure.

    Usage:
        from pathlib import Path
        from core.text_engine_discovery import TextEngineDiscovery

        engines_path = Path('backend/engines/text_processing')
        discovery = TextEngineDiscovery(engines_path)
        engines = discovery.discover_all()
    """
    pass
