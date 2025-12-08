"""
Default settings for the Audiobook Maker application.

This module defines the default global settings structure that will be
used to initialize the settings database on first run.
"""

from typing import Dict, Any

DEFAULT_GLOBAL_SETTINGS: Dict[str, Any] = {
    # Note: UI settings (theme, language) are now stored in frontend localStorage
    # and are no longer part of backend settings
    "engines": {
        # Global engine lifecycle settings
        "inactivityTimeoutMinutes": 5,  # Auto-stop timeout (0-30 minutes, 0 = stop after job)
        "autostartKeepRunning": True  # Start all keepRunning engines on app startup
    },
    "tts": {
        "defaultTtsEngine": "xtts",  # Used at app startup
        # NOTE: defaultTtsSpeaker removed - speakers table (is_default flag) is the single source of truth
        "engines": {
            # Per-engine settings (defaultLanguage, defaultModelName, parameters, keepRunning)
            # NOTE: This is empty by default!
            # Engine entries are created dynamically when engines are discovered.
            # See: SettingsService.get_all_settings() which merges discovered engines.
            # Each engine entry has: enabled, defaultLanguage, defaultModelName, parameters, keepRunning
        }
    },
    "audio": {
        # Export settings
        "defaultFormat": "m4a",  # mp3, m4a, wav
        "defaultQuality": "medium",  # low, medium, high - applies to all formats
        "pauseBetweenSegments": 500,
        "defaultDividerDuration": 2000,  # Default pause for divider segments (ms)
        # Audio Analysis Engine settings
        "defaultAudioEngine": "silero-vad",  # Audio analysis engine to use
        "engines": {
            # Per-engine settings (enabled, parameters, keepRunning)
            # Engine entries are created dynamically when engines are discovered.
            # Each engine entry has: enabled, parameters, keepRunning
            # Parameters for silero-vad include speechRatio and silence thresholds
        }
    },
    "text": {
        "defaultTextEngine": "spacy",  # Text processing engine to use
        "preferredMaxSegmentLength": 250,  # User preference (soft limit) - matches XTTS engine limit
        "engines": {
            # Per-engine settings (enabled, keepRunning)
            # Engine entries are created dynamically when engines are discovered.
            # Each engine entry has: enabled, keepRunning
        }
    },
    "stt": {
        "defaultSttEngine": "whisper",  # STT engine to use
        "engines": {
            # Per-engine settings (enabled, defaultModelName, parameters, keepRunning)
            # Engine entries are created dynamically when engines are discovered.
            # Each engine entry has: enabled, defaultModelName, parameters, keepRunning
            # Parameters for whisper include confidenceThreshold
        }
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
