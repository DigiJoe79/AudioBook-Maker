"""
Settings Service

Handles global settings persistence and retrieval.
Settings are stored in the global_settings table with JSON values.
"""
import json
from datetime import datetime
from typing import Dict, Any, Optional
from loguru import logger
from db.default_settings import DEFAULT_GLOBAL_SETTINGS


class SettingsService:
    """
    Service for managing global application settings

    Settings are stored as key-value pairs where:
    - key: Dot-notation path (e.g., 'tts.defaultEngine')
    - value: JSON-serialized value
    """

    def __init__(self, db):
        """
        Initialize settings service

        Args:
            db: Database connection
        """
        self.db = db
        self._ensure_defaults()

    def _ensure_defaults(self):
        """Initialize database with default settings if not present"""
        cursor = self.db.cursor()

        cursor.execute("SELECT COUNT(*) FROM global_settings")
        count = cursor.fetchone()[0]

        if count == 0:
            logger.info("Initializing default settings in database")
            for category, values in DEFAULT_GLOBAL_SETTINGS.items():
                self._insert_setting(category, values)
            self.db.commit()

    def _insert_setting(self, key: str, value: Any):
        """Insert or replace a setting in the database"""
        cursor = self.db.cursor()
        now = datetime.utcnow().isoformat()

        cursor.execute(
            "INSERT OR REPLACE INTO global_settings (key, value, updated_at) VALUES (?, ?, ?)",
            (key, json.dumps(value), now)
        )

    def get_all_settings(self) -> Dict[str, Any]:
        """
        Get all global settings

        Returns:
            Dictionary with all settings organized by category
        """
        cursor = self.db.cursor()
        cursor.execute("SELECT key, value FROM global_settings")

        settings = {}
        for key, value_json in cursor.fetchall():
            settings[key] = json.loads(value_json)

        return settings

    def get_setting(self, key: str) -> Optional[Any]:
        """
        Get a specific setting value

        Args:
            key: Setting key (e.g., 'tts' or 'tts.defaultEngine' with dot notation)

        Returns:
            Setting value or None if not found
        """
        cursor = self.db.cursor()
        cursor.execute("SELECT value FROM global_settings WHERE key = ?", (key,))
        row = cursor.fetchone()

        if row:
            return json.loads(row[0])

        if '.' in key:
            parts = key.split('.')
            top_key = parts[0]

            cursor.execute("SELECT value FROM global_settings WHERE key = ?", (top_key,))
            row = cursor.fetchone()

            if row:
                value = json.loads(row[0])
                for part in parts[1:]:
                    if isinstance(value, dict) and part in value:
                        value = value[part]
                    else:
                        return None
                return value

        return None

    def update_setting(self, key: str, value: Any) -> Dict[str, Any]:
        """
        Update a setting value

        Args:
            key: Setting key (top-level category like 'tts', 'audio', etc.)
            value: New value (will be JSON-serialized)

        Returns:
            Updated setting with key and value
        """
        self._insert_setting(key, value)
        self.db.commit()

        logger.info(f"Updated setting: {key}")

        return {
            "key": key,
            "value": value
        }

    def get_engine_parameters(self, engine: str) -> Dict[str, Any]:
        """
        Get TTS engine-specific parameters with defaults

        Loads parameters from settings.tts.engines[engine].parameters
        and merges with engine's default parameters as fallback.

        Args:
            engine: Engine identifier (e.g., 'xtts', 'dummy')

        Returns:
            Dictionary of engine parameters (temperature, speed, etc.)
        """
        from services.tts_manager import get_tts_manager

        tts_settings = self.get_setting('tts')
        if not tts_settings:
            logger.warning(f"No TTS settings found in database, using engine defaults for {engine}")
            manager = get_tts_manager()
            engine_class = manager._engine_classes.get(engine)
            if engine_class:
                return engine_class.get_default_parameters_static()
            return {}

        engines = tts_settings.get('engines', {})
        engine_config = engines.get(engine, {})
        db_parameters = engine_config.get('parameters', {})

        manager = get_tts_manager()
        engine_class = manager._engine_classes.get(engine)
        if engine_class:
            default_parameters = engine_class.get_default_parameters_static()
        else:
            logger.warning(f"Engine {engine} not found in registry, using DB parameters only")
            default_parameters = {}

        final_parameters = {**default_parameters, **db_parameters}

        logger.debug(f"Loaded parameters for engine {engine}: {final_parameters}")
        return final_parameters

    def update_nested_setting(self, key: str, value: Any) -> Dict[str, Any]:
        """
        Update a nested setting using dot notation

        Args:
            key: Dot-notation key (e.g., 'tts.defaultEngine')
            value: New value

        Returns:
            Updated setting
        """
        if '.' not in key:
            return self.update_setting(key, value)

        parts = key.split('.')
        category = parts[0]

        current = self.get_setting(category) or {}

        temp = current
        for part in parts[1:-1]:
            if part not in temp:
                temp[part] = {}
            temp = temp[part]

        temp[parts[-1]] = value

        return self.update_setting(category, current)

    def reset_to_defaults(self) -> Dict[str, Any]:
        """
        Reset all settings to default values

        Returns:
            Status message
        """
        cursor = self.db.cursor()
        cursor.execute("DELETE FROM global_settings")

        for category, values in DEFAULT_GLOBAL_SETTINGS.items():
            self._insert_setting(category, values)

        self.db.commit()

        logger.info("Reset all settings to defaults")

        return {"success": True, "message": "Settings reset to defaults"}

    def get_segment_limits(self, engine: str) -> Dict[str, int]:
        """
        Get effective segment length limits for text segmentation

        Combines user preference with engine constraints.

        Args:
            engine: Engine name (e.g., 'xtts', 'dummy')

        Returns:
            Dictionary with:
            - user_preference: User's preferred max length
            - engine_maximum: Engine's hard limit
            - effective_limit: Minimum of both (actual limit to use)
        """
        from services.tts_manager import TTSManager

        user_pref = self.get_setting('text.preferredMaxSegmentLength') or 250

        try:
            manager = TTSManager()
            engine_class = manager._engine_classes.get(engine)

            if engine_class:
                constraints = engine_class.get_generation_constraints_static()
                engine_max = constraints.get('max_text_length', 250)
            else:
                engine_max = 250
        except Exception as e:
            logger.warning(f"Could not get engine max length: {e}")
            engine_max = 250

        return {
            "user_preference": user_pref,
            "engine_maximum": engine_max,
            "effective_limit": min(user_pref, engine_max)
        }
