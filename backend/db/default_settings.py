"""
Default settings for the Audiobook Maker application.

This module defines the default global settings structure that will be
used to initialize the settings database on first run.
"""

from typing import Dict, Any

DEFAULT_GLOBAL_SETTINGS: Dict[str, Any] = {
    # Note: UI settings (theme, language) are now stored in frontend localStorage
    # and are no longer part of backend settings
    #
    # IMPORTANT: Engine-specific settings are stored in dedicated tables (Single Source of Truth):
    # - Default engine per type: engines.is_default
    # - Default model per engine: engine_models.is_default
    # - Default speaker: speakers.is_default
    # - Engine settings (enabled, keepRunning, parameters): engines table
    "engines": {
        # Global engine lifecycle settings
        "inactivityTimeoutMinutes": 5,  # Auto-stop timeout (0-30 minutes, 0 = stop after job)
        "autostartKeepRunning": True  # Start all keepRunning engines on app startup
    },
    "audio": {
        # Export settings
        "defaultFormat": "m4a",  # mp3, m4a, wav
        "defaultQuality": "medium",  # low, medium, high - applies to all formats
        "pauseBetweenSegments": 500,
        "defaultDividerDuration": 2000  # Default pause for divider segments (ms)
    },
    "text": {
        "preferredMaxSegmentLength": 250  # User preference (soft limit) - matches XTTS engine limit
    },
    "quality": {
        # Quality Worker settings (orchestrates STT + Audio analysis)
        "autoAnalyzeSegment": False,  # Auto-analyze after single segment generation
        "autoAnalyzeChapter": False,  # Auto-analyze after chapter generation
        "autoRegenerateDefects": 0,  # 0=Deaktiviert, 1=Gebündelt, 2=Einzeln
        "maxRegenerateAttempts": 5  # Maximum regeneration attempts per segment
    },
    "languages": {
        "allowedLanguages": ["de", "en"]  # ISO 639-1 language codes allowed for TTS
    }
}


def get_default_setting(key: str) -> Any:
    """
    Get a default setting value by dot-notation key.

    Args:
        key: Dot-notation key (e.g., 'audio.defaultFormat', 'text.preferredMaxSegmentLength')

    Returns:
        The default value for the setting, or None if not found
    """
    keys = key.split('.')
    current = DEFAULT_GLOBAL_SETTINGS

    for k in keys:
        if isinstance(current, dict) and k in current:
            current = current[k]
        else:
            return None

    return current
