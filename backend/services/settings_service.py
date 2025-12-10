"""
Settings Service

Handles global settings persistence and retrieval.
Settings are stored in the global_settings table with JSON values.
"""
import json
from datetime import datetime, timezone
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
        now = datetime.now(timezone.utc).isoformat()

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

        # Ensure all required top-level keys exist (fallback to defaults)
        # This prevents validation errors when keys are missing from DB
        for category in DEFAULT_GLOBAL_SETTINGS.keys():
            if category not in settings:
                logger.warning(f"[SETTINGS] Missing category '{category}' in DB, using default")
                settings[category] = DEFAULT_GLOBAL_SETTINGS[category]

        # Merge engine parameter defaults from engine.yaml into TTS settings
        # AND add discovered engines that are not yet in DB
        if 'tts' in settings:
            from core.tts_engine_manager import get_tts_engine_manager
            tts_manager = get_tts_engine_manager()

            # Ensure engines dict exists
            if 'engines' not in settings['tts']:
                settings['tts']['engines'] = {}

            #logger.info(f"[SETTINGS] Engines in DB: {list(settings['tts']['engines'].keys())}")
            #logger.info(f"[SETTINGS] Discovered engines: {list(tts_manager._engine_metadata.keys())}")

            # Add all discovered engines (if not already in DB)
            for engine_name in tts_manager._engine_metadata.keys():
                if engine_name not in settings['tts']['engines']:
                    # Get default language from engine metadata
                    metadata = tts_manager._engine_metadata[engine_name]
                    yaml_config = metadata.get('config', {})
                    supported_languages = yaml_config.get('supported_languages', ['en'])

                    # Filter by allowed languages to ensure default is valid
                    # Priority: Use first language from allowedLanguages that engine supports
                    allowed_langs = self.get_setting('languages.allowedLanguages') or ['en']
                    default_language = None
                    for lang in allowed_langs:
                        if lang in supported_languages:
                            default_language = lang
                            break

                    # Fallback if no overlap
                    if not default_language:
                        default_language = 'en'

                    # Get default model from available models (runtime detection)
                    # This handles engines like XTTS where models are auto-discovered from filesystem
                    default_model = None
                    try:
                        available_models = tts_manager.get_available_models(engine_name)
                        if available_models:
                            # Use engine_model_name (v0.4.1+ standard format from discovery)
                            default_model = available_models[0].get('engine_model_name')
                    except Exception as e:
                        logger.warning(f"[SETTINGS] Could not get models for {engine_name}: {e}")
                        # Fallback to static models in yaml (for engines that define them)
                        models = yaml_config.get('models', [])
                        if models:
                            first_model = models[0]
                            if isinstance(first_model, dict):
                                # YAML uses 'name', discovery converts to 'engine_model_name'
                                default_model = first_model.get('name')
                            else:
                                default_model = first_model

                    # Get enabled state from engine.yaml (default: True if not specified)
                    default_enabled = yaml_config.get('enabled', True)

                    settings['tts']['engines'][engine_name] = {
                        'enabled': default_enabled,
                        'defaultLanguage': default_language,
                        'defaultModelName': default_model,  # Per-engine default model
                        'parameters': {},
                        'keepRunning': False  # Default: allow auto-stop
                    }

            # Now merge defaults for all engines
            for engine_name in list(settings['tts']['engines'].keys()):
                # Skip engines that no longer exist (removed/disabled)
                if engine_name not in tts_manager._engine_metadata:
                    # logger.warning(f"[SETTINGS] Engine '{engine_name}' in DB but not discovered, keeping in settings")
                    continue

                # Get default parameters from engine metadata
                metadata = tts_manager._engine_metadata[engine_name]

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

                # Ensure keepRunning exists (for existing DB entries without it)
                if 'keepRunning' not in settings['tts']['engines'][engine_name]:
                    settings['tts']['engines'][engine_name]['keepRunning'] = False

                # Ensure defaultModelName exists (for existing DB entries without it)
                if not settings['tts']['engines'][engine_name].get('defaultModelName'):
                    try:
                        available_models = tts_manager.get_available_models(engine_name)
                        if available_models:
                            # Use engine_model_name (v0.4.1+ standard format from discovery)
                            settings['tts']['engines'][engine_name]['defaultModelName'] = available_models[0].get('engine_model_name')
                    except Exception as e:
                        logger.warning(f"[SETTINGS] Could not get models for {engine_name}: {e}")
                        # Fallback to static models in yaml
                        models = yaml_config.get('models', [])
                        if models:
                            first_model = models[0]
                            if isinstance(first_model, dict):
                                # YAML uses 'name', discovery converts to 'engine_model_name'
                                settings['tts']['engines'][engine_name]['defaultModelName'] = first_model.get('name')
                            else:
                                settings['tts']['engines'][engine_name]['defaultModelName'] = first_model

        # Merge STT engine discovery (similar to TTS)
        if 'stt' in settings:
            from core.stt_engine_manager import get_stt_engine_manager
            stt_manager = get_stt_engine_manager()

            # Ensure engines dict exists
            if 'engines' not in settings['stt']:
                settings['stt']['engines'] = {}

            # Add all discovered STT engines
            for engine_name in stt_manager._engine_metadata.keys():
                if engine_name not in settings['stt']['engines']:
                    metadata = stt_manager._engine_metadata[engine_name]
                    yaml_config = metadata.get('config', {})

                    # Get default model from engine metadata
                    models = yaml_config.get('models', [])
                    default_model = None
                    if models:
                        first_model = models[0]
                        if isinstance(first_model, dict):
                            default_model = first_model.get('name') or first_model.get('model_name')
                        else:
                            default_model = first_model

                    # Get enabled state from engine.yaml (default: True if not specified)
                    default_enabled = yaml_config.get('enabled', True)

                    settings['stt']['engines'][engine_name] = {
                        'enabled': default_enabled,
                        'defaultModelName': default_model,
                        'parameters': {},
                        'keepRunning': False  # Default: allow auto-stop
                    }

            # Merge parameters for all STT engines (similar to TTS)
            for engine_name in list(settings['stt']['engines'].keys()):
                if engine_name not in stt_manager._engine_metadata:
                    continue

                metadata = stt_manager._engine_metadata[engine_name]
                yaml_config = metadata.get('config', {})
                parameter_schema = yaml_config.get('config', {}).get('parameter_schema', {})

                # Extract defaults from parameter_schema
                default_parameters = {}
                for param_name, param_config in parameter_schema.items():
                    if 'default' in param_config:
                        default_parameters[param_name] = param_config['default']

                # Merge: DB parameters override defaults
                if 'parameters' not in settings['stt']['engines'][engine_name]:
                    settings['stt']['engines'][engine_name]['parameters'] = {}
                db_parameters = settings['stt']['engines'][engine_name].get('parameters', {})
                merged_parameters = {**default_parameters, **db_parameters}
                settings['stt']['engines'][engine_name]['parameters'] = merged_parameters

                # Ensure keepRunning exists (for existing DB entries without it)
                if 'keepRunning' not in settings['stt']['engines'][engine_name]:
                    settings['stt']['engines'][engine_name]['keepRunning'] = False

                # Ensure defaultModelName exists
                if not settings['stt']['engines'][engine_name].get('defaultModelName'):
                    models = yaml_config.get('models', [])
                    if models:
                        first_model = models[0]
                        if isinstance(first_model, dict):
                            settings['stt']['engines'][engine_name]['defaultModelName'] = first_model.get('name') or first_model.get('model_name')
                        else:
                            settings['stt']['engines'][engine_name]['defaultModelName'] = first_model

        # Merge Text engine discovery
        if 'text' in settings:
            from core.text_engine_manager import get_text_engine_manager
            text_manager = get_text_engine_manager()

            # Ensure engines dict exists
            if 'engines' not in settings['text']:
                settings['text']['engines'] = {}

            # Add all discovered Text engines
            for engine_name in text_manager._engine_metadata.keys():
                if engine_name not in settings['text']['engines']:
                    metadata = text_manager._engine_metadata[engine_name]
                    yaml_config = metadata.get('config', {})
                    # Get enabled state from engine.yaml (default: True if not specified)
                    default_enabled = yaml_config.get('enabled', True)

                    settings['text']['engines'][engine_name] = {
                        'enabled': default_enabled,
                        'keepRunning': False  # Default: allow auto-stop
                    }
                else:
                    # Ensure keepRunning exists for existing DB entries
                    if 'keepRunning' not in settings['text']['engines'][engine_name]:
                        settings['text']['engines'][engine_name]['keepRunning'] = False

        # Merge Audio engine discovery
        if 'audio' not in settings:
            settings['audio'] = {'engines': {}}
        if 'engines' not in settings['audio']:
            settings['audio']['engines'] = {}

        from core.audio_engine_manager import get_audio_engine_manager
        audio_manager = get_audio_engine_manager()

        for engine_name in audio_manager._engine_metadata.keys():
            if engine_name not in settings['audio'].get('engines', {}):
                metadata = audio_manager._engine_metadata[engine_name]
                yaml_config = metadata.get('config', {})

                # Get default model from engine.yaml
                default_model = yaml_config.get('default_model')
                if not default_model:
                    # Fallback to first model in models list
                    models = yaml_config.get('models', [])
                    if models:
                        first_model = models[0]
                        if isinstance(first_model, dict):
                            default_model = first_model.get('name')
                        else:
                            default_model = first_model

                # Get enabled state from engine.yaml (default: True if not specified)
                default_enabled = yaml_config.get('enabled', True)

                settings['audio']['engines'][engine_name] = {
                    'enabled': default_enabled,
                    'defaultModelName': default_model,
                    'parameters': {},
                    'keepRunning': False  # Default: allow auto-stop
                }

        # Merge parameters for all Audio engines (similar to TTS)
        for engine_name in list(settings['audio']['engines'].keys()):
            if engine_name not in audio_manager._engine_metadata:
                continue

            metadata = audio_manager._engine_metadata[engine_name]
            yaml_config = metadata.get('config', {})
            parameter_schema = yaml_config.get('config', {}).get('parameter_schema', {})

            # Extract defaults from parameter_schema
            default_parameters = {}
            for param_name, param_config in parameter_schema.items():
                if 'default' in param_config:
                    default_parameters[param_name] = param_config['default']

            # Merge: DB parameters override defaults
            if 'parameters' not in settings['audio']['engines'][engine_name]:
                settings['audio']['engines'][engine_name]['parameters'] = {}
            db_parameters = settings['audio']['engines'][engine_name].get('parameters', {})
            merged_parameters = {**default_parameters, **db_parameters}
            settings['audio']['engines'][engine_name]['parameters'] = merged_parameters

            # Ensure keepRunning exists (for existing DB entries without it)
            if 'keepRunning' not in settings['audio']['engines'][engine_name]:
                settings['audio']['engines'][engine_name]['keepRunning'] = False

        # Ensure quality settings exist (new key added in v0.4.2)
        if 'quality' not in settings:
            settings['quality'] = DEFAULT_GLOBAL_SETTINGS.get('quality', {
                'autoAnalyzeSegment': False,
                'autoAnalyzeChapter': False,
                'autoRegenerateDefects': False,
                'maxRegenerateAttempts': 5
            })

        # Persist merged settings back to DB so they're available on next read
        # This ensures discovered engines are saved and don't need to be re-merged
        for category in ['engines', 'tts', 'stt', 'text', 'audio', 'quality']:
            if category in settings:
                self._insert_setting(category, settings[category])
        self.db.commit()

        return settings

    def get_setting(self, key: str) -> Optional[Any]:
        """
        Get a specific setting value

        Args:
            key: Setting key (e.g., 'tts' or 'tts.defaultTtsEngine' with dot notation)

        Returns:
            Setting value, falling back to defaults if not found in DB
        """
        from db.default_settings import get_default_setting

        # First, try to get top-level key from DB
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
                        # Not found in DB value, fall back to default
                        default = get_default_setting(key)
                        if default is not None:
                            logger.debug(f"[SETTINGS] Using default for '{key}' (nested key not in DB)")
                        return default
                return value

        # Not found in DB at all - fall back to default
        default = get_default_setting(key)
        if default is not None:
            logger.info(f"[SETTINGS] Key '{key}' not in DB, using default value")
            # Auto-persist the default to DB for future use
            self._insert_setting(key, default)
            self.db.commit()
        return default

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

        # Special handling for 'engines' category - sync to engine managers
        if key == 'engines' and isinstance(value, dict):
            self._sync_engine_settings_to_managers(value)

        return {
            "key": key,
            "value": value
        }

    def _sync_engine_settings_to_managers(self, engines_settings: Dict[str, Any]) -> None:
        """
        Sync engine settings to all engine managers

        Called when 'engines' category is updated via generic update_setting.
        Syncs inactivityTimeoutMinutes to all managers.

        Args:
            engines_settings: The engines settings dict
        """
        try:
            from core.tts_engine_manager import get_tts_engine_manager
            from core.stt_engine_manager import get_stt_engine_manager
            from core.text_engine_manager import get_text_engine_manager
            from core.audio_engine_manager import get_audio_engine_manager

            # Sync inactivity timeout if present
            if 'inactivityTimeoutMinutes' in engines_settings:
                for manager in [get_tts_engine_manager(), get_stt_engine_manager(),
                                get_text_engine_manager(), get_audio_engine_manager()]:
                    if manager:
                        manager.sync_inactivity_timeout_from_settings()
                logger.info("Synced inactivity timeout to all engine managers")

        except Exception as e:
            logger.warning(f"Could not sync engine settings to managers: {e}")

    def get_engine_parameters(self, engine: str) -> Dict[str, Any]:
        """
        Get TTS engine-specific parameters with defaults

        Loads parameters from settings.tts.engines[engine].parameters
        and merges with engine's default parameters as fallback.

        Args:
            engine: Engine identifier

        Returns:
            Dictionary of engine parameters (temperature, speed, etc.)
            NOTE: Keys are snake_case (backend-consumed, from engine.yaml)
        """
        from core.tts_engine_manager import get_tts_engine_manager

        # Get TTS settings from database
        tts_settings = self.get_setting('tts')
        if not tts_settings:
            logger.warning(f"No TTS settings found in database, using engine defaults for {engine}")
            # Fallback to engine defaults from metadata
            tts_manager = get_tts_engine_manager()
            if engine in tts_manager._engine_metadata:
                metadata = tts_manager._engine_metadata[engine]
                return metadata.get('config', {}).get('default_parameters', {})
            return {}

        # Navigate to engine-specific parameters
        engines = self.get_setting('tts.engines') or {}
        engine_config = engines.get(engine, {})
        db_parameters = engine_config.get('parameters', {})

        # Get engine's default parameters from metadata
        tts_manager = get_tts_engine_manager()
        default_parameters = {}

        if engine in tts_manager._engine_metadata:
            metadata = tts_manager._engine_metadata[engine]

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
            from core.tts_engine_manager import get_tts_engine_manager
            tts_manager = get_tts_engine_manager()

            # Get engine metadata (contains config from engine.yaml)
            if engine in tts_manager._engine_metadata:
                metadata = tts_manager._engine_metadata[engine]
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

    def get_enabled_engines(self, engine_type: str = 'tts') -> list[str]:
        """
        Get list of enabled engine names for given type

        Args:
            engine_type: Type of engine ('tts', 'text', 'stt', 'audio')

        Returns:
            List of enabled engine names
        """
        settings_key = engine_type
        settings = self.get_setting(settings_key)

        if not settings:
            return []

        engines = self.get_setting(f'{settings_key}.engines') or {}
        enabled = []

        for engine_name, engine_config in engines.items():
            # Default to True if 'enabled' key missing (engines are enabled by default)
            if engine_config.get('enabled', True):
                enabled.append(engine_name)

        return enabled

    def is_engine_enabled(self, engine_name: str, engine_type: str = 'tts') -> bool:
        """
        Check if specific engine is enabled

        Engines are enabled by default. Returns True unless explicitly disabled
        in settings ({engine_type}.engines.{engine_name}.enabled = false).

        Args:
            engine_name: Engine identifier
            engine_type: Type of engine ('tts', 'text', 'stt', 'audio')

        Returns:
            True if enabled (or no settings exist), False only if explicitly disabled
        """
        settings_key = engine_type
        settings = self.get_setting(settings_key)

        if not settings:
            # No settings for this engine type - default to enabled
            # (engines are enabled by default per docstring)
            return True

        engines = self.get_setting(f'{settings_key}.engines') or {}
        engine_config = engines.get(engine_name, {})

        # Default to True if 'enabled' key missing (engines are enabled by default)
        return engine_config.get('enabled', True)

    def set_engine_enabled(self, engine_name: str, enabled: bool, engine_type: str = 'tts') -> bool:
        """
        Enable or disable an engine

        Validates that default engine cannot be disabled.

        Args:
            engine_name: Engine identifier
            enabled: True to enable, False to disable
            engine_type: Type of engine ('tts', 'text', 'stt', 'audio')

        Returns:
            True if successful, False if validation failed

        Raises:
            ValueError: If trying to disable default TTS engine
        """
        settings_key = engine_type
        settings = self.get_setting(settings_key)

        if not settings:
            logger.error(f"Settings for '{settings_key}' not found")
            return False

        # Get or create engines dict - use settings['engines'] directly to avoid reference issues
        if 'engines' not in settings:
            settings['engines'] = {}
        engines = settings['engines']

        # Create engine entry if it doesn't exist
        if engine_name not in engines:
            logger.info(f"Creating engine entry for '{engine_name}' in {settings_key} settings")
            engines[engine_name] = {'enabled': True}  # Default to enabled

        # Validation: Cannot disable default TTS engine
        if engine_type == 'tts' and not enabled:
            default_engine = settings.get('defaultTtsEngine')
            if engine_name == default_engine:
                raise ValueError(f"Cannot disable default TTS engine '{engine_name}'. Please select a different default engine first.")

        # Update enabled flag
        engines[engine_name]['enabled'] = enabled

        # Save settings
        self.update_setting(settings_key, settings)

        logger.info(f"Engine '{engine_name}' ({engine_type}) {'enabled' if enabled else 'disabled'}")
        return True

    def get_default_engine(self, engine_type: str) -> str:
        """
        Get the default engine name for a given type

        Args:
            engine_type: Type of engine ('tts', 'stt', 'text', 'audio')

        Returns:
            Default engine name or empty string if not found
        """
        settings = self.get_setting(engine_type)
        if not settings:
            return ''

        # Map engine type to settings key
        key_map = {
            'tts': 'defaultTtsEngine',
            'stt': 'defaultSttEngine',
            'text': 'defaultTextEngine',
            'audio': 'defaultAudioEngine'
        }

        key = key_map.get(engine_type)
        if not key:
            logger.warning(f"Unknown engine type: {engine_type}")
            return ''

        return settings.get(key, '')

    def get_default_model_for_engine(self, engine_name: str, engine_type: str) -> str:
        """
        Get the default model for a specific engine

        Uses get_all_settings() to ensure engine defaults are merged from
        engine.yaml files (including runtime-discovered models like XTTS).

        Args:
            engine_name: Engine identifier
            engine_type: Type of engine ('tts', 'stt')

        Returns:
            Default model name or empty string if not found
        """
        # Use get_all_settings() to get merged settings with discovered engines
        all_settings = self.get_all_settings()

        settings = all_settings.get(engine_type, {})
        if not settings:
            return ''

        engines = self.get_setting(f'{engine_type}.engines') or {}
        engine_config = engines.get(engine_name, {})

        return engine_config.get('defaultModelName', '')

    def set_default_engine(self, engine_type: str, engine_name: str) -> bool:
        """
        Set the default engine for a given type

        Args:
            engine_type: Type of engine ('tts', 'stt', 'text', 'audio')
            engine_name: Engine identifier to set as default (empty string to clear default)

        Returns:
            True if successful

        Raises:
            ValueError: If engine is not enabled or not found
        """
        settings = self.get_setting(engine_type)
        if not settings:
            settings = {'engines': {}}

        # Ensure engines dict exists
        if 'engines' not in settings:
            settings['engines'] = {}

        engines = settings['engines']

        # Allow clearing the default engine (empty string or None)
        if not engine_name:
            # For TTS, we don't allow clearing the default (must always have one)
            if engine_type == 'tts':
                raise ValueError("TTS must have a default engine configured")
            # For other types (STT, Audio, Text), allow clearing the default
            # Also disable all engines of this type since none is active
            for other_engine_name, other_config in engines.items():
                other_config['enabled'] = False
            logger.info(f"Clearing default {engine_type} engine and disabling all engines")
        else:
            # If engine not in settings, check if it exists in the engine manager and add it
            if engine_name not in engines:
                # Verify engine exists in the actual engine manager
                engine_exists = False
                try:
                    if engine_type == 'tts':
                        from core.tts_engine_manager import get_tts_engine_manager
                        engine_exists = engine_name in get_tts_engine_manager()._engine_metadata
                    elif engine_type == 'stt':
                        from core.stt_engine_manager import get_stt_engine_manager
                        engine_exists = engine_name in get_stt_engine_manager()._engine_metadata
                    elif engine_type == 'text':
                        from core.text_engine_manager import get_text_engine_manager
                        engine_exists = engine_name in get_text_engine_manager()._engine_metadata
                    elif engine_type == 'audio':
                        from core.audio_engine_manager import get_audio_engine_manager
                        engine_exists = engine_name in get_audio_engine_manager()._engine_metadata
                except Exception as e:
                    logger.warning(f"Could not verify engine existence: {e}")

                if not engine_exists:
                    raise ValueError(f"Engine '{engine_name}' not found in {engine_type} engines")

                # Add the engine to settings with default enabled=True
                logger.info(f"Adding engine '{engine_name}' to {engine_type} settings")
                engines[engine_name] = {'enabled': True}

            # For single-engine types (STT, Audio, Text), selecting an engine
            # automatically enables it and disables all others - only ONE can be active
            if engine_type in ('stt', 'audio', 'text'):
                for other_engine_name, other_config in engines.items():
                    if other_engine_name == engine_name:
                        # Enable the selected engine
                        other_config['enabled'] = True
                    else:
                        # Disable all other engines of this type
                        other_config['enabled'] = False
                logger.info(f"Single-engine mode: enabled '{engine_name}', disabled others for {engine_type}")
            else:
                # For TTS (multi-engine), check if engine is enabled before setting as default
                engine_config = engines.get(engine_name, {})
                if not engine_config.get('enabled', True):
                    raise ValueError(f"Cannot set disabled engine '{engine_name}' as default")

        # Map engine type to settings key
        key_map = {
            'tts': 'defaultTtsEngine',
            'stt': 'defaultSttEngine',
            'text': 'defaultTextEngine',
            'audio': 'defaultAudioEngine'
        }

        key = key_map.get(engine_type)
        if not key:
            raise ValueError(f"Unknown engine type: {engine_type}")

        # Update default engine
        settings[key] = engine_name
        self.update_setting(engine_type, settings)

        logger.info(f"Set default {engine_type} engine to '{engine_name}'")
        return True

    def set_default_model_for_engine(self, engine_name: str, model_name: str, engine_type: str) -> bool:
        """
        Set the default model for a specific engine

        Args:
            engine_name: Engine identifier
            model_name: Model name to set as default
            engine_type: Type of engine ('tts', 'stt')

        Returns:
            True if successful

        Raises:
            ValueError: If engine not found
        """
        settings = self.get_setting(engine_type)
        if not settings:
            raise ValueError(f"Settings for '{engine_type}' not found")

        engines = self.get_setting(f'{engine_type}.engines') or {}
        if engine_name not in engines:
            raise ValueError(f"Engine '{engine_name}' not found in {engine_type} settings")

        # Update default model
        engines[engine_name]['defaultModelName'] = model_name
        self.update_setting(engine_type, settings)

        logger.info(f"Set default model for {engine_type} engine '{engine_name}' to '{model_name}'")
        return True

    def get_inactivity_timeout(self) -> int:
        """
        Get global engine inactivity timeout in SECONDS

        Reads timeout from settings (stored in minutes) and converts to seconds
        for backend consumption.

        Returns:
            Timeout in seconds (default: 300 = 5 minutes)
        """
        timeout_minutes = self.get_setting('engines.inactivityTimeoutMinutes')
        if timeout_minutes is None:
            # Fallback to default
            from db.default_settings import get_default_setting
            timeout_minutes = get_default_setting('engines.inactivityTimeoutMinutes') or 5

        return timeout_minutes * 60  # Convert minutes to seconds

    def set_inactivity_timeout(self, minutes: int) -> None:
        """
        Set global engine inactivity timeout

        Args:
            minutes: Timeout in minutes (0-30 range enforced)
                     0 = stop engine immediately after job completion

        Raises:
            ValueError: If minutes is out of valid range
        """
        if not 0 <= minutes <= 30:
            raise ValueError("Inactivity timeout must be between 0 and 30 minutes")

        self.update_nested_setting('engines.inactivityTimeoutMinutes', minutes)
        logger.info(f"Set inactivity timeout to {minutes} minutes")

        # Notify all engine managers to sync the new timeout
        try:
            from core.tts_engine_manager import get_tts_engine_manager
            from core.stt_engine_manager import get_stt_engine_manager
            from core.text_engine_manager import get_text_engine_manager
            from core.audio_engine_manager import get_audio_engine_manager

            for manager in [get_tts_engine_manager(), get_stt_engine_manager(),
                            get_text_engine_manager(), get_audio_engine_manager()]:
                if manager:
                    manager.sync_inactivity_timeout_from_settings()

            logger.info("Synced inactivity timeout to all engine managers")
        except Exception as e:
            logger.warning(f"Could not sync inactivity timeout to managers: {e}")

    def get_autostart_keep_running(self) -> bool:
        """
        Get whether keepRunning engines should autostart on app startup

        Returns:
            True if keepRunning engines should autostart (default: True)
        """
        autostart = self.get_setting('engines.autostartKeepRunning')
        if autostart is None:
            # Fallback to default
            from db.default_settings import get_default_setting
            autostart = get_default_setting('engines.autostartKeepRunning')
            if autostart is None:
                autostart = True

        return autostart

    def set_autostart_keep_running(self, enabled: bool) -> None:
        """
        Set whether keepRunning engines should autostart on app startup

        Args:
            enabled: True to enable autostart, False to disable
        """
        self.update_nested_setting('engines.autostartKeepRunning', enabled)
        logger.info(f"Set autostart keepRunning engines to {enabled}")

    def get_engine_keep_running(self, engine_name: str, engine_type: str) -> bool:
        """
        Check if engine should be kept running (exempt from auto-stop)

        Args:
            engine_name: Engine identifier
            engine_type: Type of engine ('tts', 'stt', 'text', 'audio')

        Returns:
            True if engine should stay running, False otherwise
        """
        settings = self.get_setting(engine_type)
        if not settings:
            return False

        engines = self.get_setting(f'{engine_type}.engines') or {}
        engine_config = engines.get(engine_name, {})

        # Default to False if 'keepRunning' key missing
        return engine_config.get('keepRunning', False)

    def set_engine_keep_running(self, engine_name: str, keep_running: bool, engine_type: str) -> None:
        """
        Set keepRunning flag for a specific engine

        Notifies the appropriate engine manager to sync the runtime state.

        Args:
            engine_name: Engine identifier
            keep_running: True to keep engine running, False to allow auto-stop
            engine_type: Type of engine ('tts', 'stt', 'audio', 'text')

        Raises:
            ValueError: If engine not found
        """
        settings = self.get_setting(engine_type)
        if not settings:
            raise ValueError(f"Settings for '{engine_type}' not found")

        # Get or create engines dict
        engines = self.get_setting(f'{engine_type}.engines') or {}
        if 'engines' not in settings:
            settings['engines'] = engines

        # Create engine entry if it doesn't exist
        if engine_name not in engines:
            logger.info(f"Creating engine entry for '{engine_name}' in {engine_type} settings")
            engines[engine_name] = {'enabled': True, 'keepRunning': False}

        # Update keepRunning flag
        engines[engine_name]['keepRunning'] = keep_running

        # Save settings
        self.update_setting(engine_type, settings)

        # Notify engine manager to sync runtime state
        try:
            if engine_type == 'tts':
                from core.tts_engine_manager import get_tts_engine_manager
                manager = get_tts_engine_manager()
            elif engine_type == 'stt':
                from core.stt_engine_manager import get_stt_engine_manager
                manager = get_stt_engine_manager()
            elif engine_type == 'audio':
                from core.audio_engine_manager import get_audio_engine_manager
                manager = get_audio_engine_manager()
            elif engine_type == 'text':
                from core.text_engine_manager import get_text_engine_manager
                manager = get_text_engine_manager()
            else:
                raise ValueError(f"Unknown engine type: {engine_type}")

            # Sync the keepRunning state in the manager
            # Manager will update its internal _keep_running dict
            if hasattr(manager, 'sync_keep_running_state'):
                manager.sync_keep_running_state(engine_name, keep_running)
                logger.info(f"Synced keepRunning state for '{engine_name}' ({engine_type}) to {keep_running}")
        except Exception as e:
            logger.warning(f"Could not sync keepRunning state to manager: {e}")

        logger.info(f"Engine '{engine_name}' ({engine_type}) keepRunning set to {keep_running}")
