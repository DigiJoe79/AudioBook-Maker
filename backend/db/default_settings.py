"""
Default settings for the Audiobook Maker application.

This module defines the default global settings structure that will be
used to initialize the settings database on first run.
"""

from typing import Dict, Any

DEFAULT_GLOBAL_SETTINGS: Dict[str, Any] = {
    # Note: UI settings (theme, language) are now stored in frontend localStorage
    # and are no longer part of backend settings
    "tts": {
        "defaultTtsEngine": "xtts",  # Used at app startup
        "defaultTtsModelName": "v2.0.2",  # Used at app startup
        "defaultTtsSpeaker": None,  # Used at app startup
        "engines": {
            # Per-engine settings (defaultLanguage + parameters)
            # NOTE: This is empty by default!
            # Engine entries are created dynamically when engines are discovered.
            # See: SettingsService.get_all_settings() which merges discovered engines.
        }
    },
    "audio": {
        "defaultFormat": "m4a",  # mp3, m4a, wav
        "defaultQuality": "medium",  # low, medium, high - applies to all formats
        "pauseBetweenSegments": 500,
        "defaultDividerDuration": 2000,  # Default pause for divider segments (ms)
        "volumeNormalization": {
            "enabled": False,
            "targetLevel": -20,  # LUFS
            "truePeak": -1  # dBFS
        }
    },
    "text": {
        "defaultSegmentationMethod": "smart",
        "preferredMaxSegmentLength": 250,  # User preference (soft limit) - matches XTTS engine limit
        "autoCreateSegments": True,
        "autoDetectLanguage": False
    }
}


def get_default_setting(key: str) -> Any:
    """
    Get a default setting value by dot-notation key.

    Args:
        key: Dot-notation key (e.g., 'tts.defaultTtsEngine')

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
