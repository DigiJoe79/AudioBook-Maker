"""
Default settings for the Audiobook Maker application.

This module defines the default global settings structure that will be
used to initialize the settings database on first run.
"""

from typing import Dict, Any

DEFAULT_GLOBAL_SETTINGS: Dict[str, Any] = {
    "tts": {
        "defaultEngine": "xtts",
        "defaultModelName": "v2.0.2",
        "defaultSpeaker": None,
        "engines": {
            "xtts": {
                "defaultLanguage": "de",
                "parameters": {}
            },
            "dummy": {
                "defaultLanguage": "en",
                "parameters": {}
            }
        }
    },
    "audio": {
        "defaultFormat": "m4a",
        "defaultQuality": "medium",
        "pauseBetweenSegments": 500,
        "defaultDividerDuration": 2000,
        "volumeNormalization": {
            "enabled": False,
            "targetLevel": -20,
            "truePeak": -1
        }
    },
    "text": {
        "defaultSegmentationMethod": "smart",
        "preferredMaxSegmentLength": 250,
        "autoCreateSegments": True,
        "autoDetectLanguage": False
    }
}


def get_default_setting(key: str) -> Any:
    """
    Get a default setting value by dot-notation key.

    Args:
        key: Dot-notation key (e.g., 'tts.defaultEngine')

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
