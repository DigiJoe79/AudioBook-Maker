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

        # Check if settings exist
        cursor.execute("SELECT COUNT(*) FROM global_settings")
        count = cursor.fetchone()[0]

        if count == 0:
            logger.info("Initializing default settings in database")
            # Flatten DEFAULT_GLOBAL_SETTINGS and insert
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
        Get all global settings with engine defaults merged

        Returns:
            Dictionary with all settings organized by category
        """

        cursor = self.db.cursor()
        cursor.execute("SELECT key, value FROM global_settings")

        settings = {}
        for key, value_json in cursor.fetchall():
            settings[key] = json.loads(value_json)

        # Merge engine parameter defaults from engine.yaml into TTS settings
        # AND add discovered engines that are not yet in DB
        if 'tts' in settings:
            from core.engine_manager import get_engine_manager
            manager = get_engine_manager()

            # Ensure engines dict exists
            if 'engines' not in settings['tts']:
                settings['tts']['engines'] = {}

            #logger.info(f"[SETTINGS] Engines in DB: {list(settings['tts']['engines'].keys())}")
            #logger.info(f"[SETTINGS] Discovered engines: {list(manager._engine_metadata.keys())}")

            # Add all discovered engines (if not already in DB)
            for engine_name in manager._engine_metadata.keys():
                if engine_name not in settings['tts']['engines']:
                    # Get default language from engine metadata
                    metadata = manager._engine_metadata[engine_name]
                    yaml_config = metadata.get('config', {})
                    supported_languages = yaml_config.get('supported_languages', ['en'])
                    default_language = supported_languages[0] if supported_languages else 'en'

                    settings['tts']['engines'][engine_name] = {
                        'defaultLanguage': default_language,
                        'parameters': {}
                    }

            # Now merge defaults for all engines
            for engine_name in list(settings['tts']['engines'].keys()):
                # Skip engines that no longer exist (removed/disabled)
                if engine_name not in manager._engine_metadata:
                    logger.warning(f"[SETTINGS] Engine '{engine_name}' in DB but not discovered, keeping in settings")
                    continue

                # Get default parameters from engine metadata
                metadata = manager._engine_metadata[engine_name]

                # Extract defaults from parameter_schema
                # Note: metadata['config'] contains the entire engine.yaml,
                # which itself has a 'config' field with 'parameter_schema'
                yaml_config = metadata.get('config', {})
                parameter_schema = yaml_config.get('config', {}).get('parameter_schema', {})
                #logger.info(f"[SETTINGS] Parameter schema for {engine_name}: {parameter_schema}")

                default_parameters = {}
                for param_name, param_config in parameter_schema.items():
                    if 'default' in param_config:
                        default_parameters[param_name] = param_config['default']
                        #logger.info(f"[SETTINGS] Found default for {param_name}: {param_config['default']}")

                #logger.info(f"[SETTINGS] Extracted default parameters for {engine_name}: {default_parameters}")

                # Merge: DB parameters override defaults
                db_parameters = settings['tts']['engines'][engine_name].get('parameters', {})
                #logger.info(f"[SETTINGS] DB parameters for {engine_name}: {db_parameters}")

                merged_parameters = {**default_parameters, **db_parameters}
                #logger.info(f"[SETTINGS] Merged parameters for {engine_name}: {merged_parameters}")

                # Update settings with merged parameters
                settings['tts']['engines'][engine_name]['parameters'] = merged_parameters

        return settings

    def get_setting(self, key: str) -> Optional[Any]:
        """
        Get a specific setting value

        Args:
            key: Setting key (e.g., 'tts' or 'tts.defaultTtsEngine' with dot notation)

        Returns:
            Setting value or None if not found
        """
        # First, try to get top-level key
        cursor = self.db.cursor()
        cursor.execute("SELECT value FROM global_settings WHERE key = ?", (key,))
        row = cursor.fetchone()

        if row:
            return json.loads(row[0])

        # If not found and key contains dots, try to navigate nested structure
        if '.' in key:
            parts = key.split('.')
            top_key = parts[0]

            cursor.execute("SELECT value FROM global_settings WHERE key = ?", (top_key,))
            row = cursor.fetchone()

            if row:
                value = json.loads(row[0])
                # Navigate through nested structure
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

        #logger.info(f"Updated setting: {key}")

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
            engine: Engine identifier

        Returns:
            Dictionary of engine parameters (temperature, speed, etc.)
        """
        from core.engine_manager import get_engine_manager

        # Get TTS settings from database
        tts_settings = self.get_setting('tts')
        if not tts_settings:
            logger.warning(f"No TTS settings found in database, using engine defaults for {engine}")
            # Fallback to engine defaults from metadata
            manager = get_engine_manager()
            if engine in manager._engine_metadata:
                metadata = manager._engine_metadata[engine]
                return metadata.get('config', {}).get('default_parameters', {})
            return {}

        # Navigate to engine-specific parameters
        engines = tts_settings.get('engines', {})
        engine_config = engines.get(engine, {})
        db_parameters = engine_config.get('parameters', {})

        # Get engine's default parameters from metadata
        manager = get_engine_manager()
        default_parameters = {}

        if engine in manager._engine_metadata:
            metadata = manager._engine_metadata[engine]

            # Try to get from default_parameters (legacy format)
            # Note: metadata['config'] contains the entire engine.yaml
            yaml_config = metadata.get('config', {})
            default_parameters = yaml_config.get('config', {}).get('default_parameters', {})

            # If not found, extract defaults from parameter_schema
            if not default_parameters:
                parameter_schema = yaml_config.get('config', {}).get('parameter_schema', {})
                for param_name, param_config in parameter_schema.items():
                    if 'default' in param_config:
                        default_parameters[param_name] = param_config['default']

            logger.debug(f"Loaded default parameters for engine {engine}: {default_parameters}")
        else:
            logger.warning(f"Engine {engine} not found in metadata, using DB parameters only")

        # Merge: DB parameters override defaults
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
            # If no dot, treat as top-level
            return self.update_setting(key, value)

        # Split into category and nested path
        parts = key.split('.')
        category = parts[0]

        # Get current category settings
        current = self.get_setting(category) or {}

        # Navigate and update nested value
        temp = current
        for part in parts[1:-1]:
            if part not in temp:
                temp[part] = {}
            temp = temp[part]

        # Set final value
        temp[parts[-1]] = value

        # Update entire category
        return self.update_setting(category, current)

    def reset_to_defaults(self) -> Dict[str, Any]:
        """
        Reset all settings to default values

        Returns:
            Status message
        """
        cursor = self.db.cursor()
        cursor.execute("DELETE FROM global_settings")

        # Re-insert defaults
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
            engine: Engine name

        Returns:
            Dictionary with:
            - user_preference: User's preferred max length
            - engine_maximum: Engine's hard limit
            - effective_limit: Minimum of both (actual limit to use)
        """
        # Get user preference
        user_pref = self.get_setting('text.preferredMaxSegmentLength') or 250

        # Get engine maximum from engine metadata
        try:
            from core.engine_manager import get_engine_manager
            manager = get_engine_manager()

            # Get engine metadata (contains config from engine.yaml)
            if engine in manager._engine_metadata:
                metadata = manager._engine_metadata[engine]
                # Check if constraints are defined in engine.yaml
                constraints = metadata.get('constraints', {})
                engine_max = constraints.get('max_text_length', 500)  # Default to 500
            else:
                logger.warning(f"Engine '{engine}' not found in metadata, using default limit")
                engine_max = 500  # Fallback to generous limit
        except Exception as e:
            logger.warning(f"Could not get engine max length: {e}")
            engine_max = 500  # Fallback to generous limit

        return {
            "user_preference": user_pref,
            "engine_maximum": engine_max,
            "effective_limit": min(user_pref, engine_max)
        }
