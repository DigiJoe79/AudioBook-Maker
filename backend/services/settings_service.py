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
from core.base_engine_manager import parse_variant_id


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

        Uses the new per-variant settings structure:
        - variants: Per-variant settings (enabled, defaultModelName, keepRunning)
        - engineDefaults: Shared settings per base engine (defaultLanguage, parameters)

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

        # NOTE: Engine-specific settings (variants, engineDefaults) are NO LONGER merged here.
        # Engine settings are now in the 'engines' table (Single Source of Truth).
        # The _merge_*_engine_settings() methods are kept for backwards compatibility
        # but should NOT be called from get_all_settings().

        # Ensure quality settings exist (new key added in v0.4.2)
        if 'quality' not in settings:
            settings['quality'] = DEFAULT_GLOBAL_SETTINGS.get('quality', {
                'autoAnalyzeSegment': False,
                'autoAnalyzeChapter': False,
                'autoRegenerateDefects': False,
                'maxRegenerateAttempts': 5
            })

        # Persist app-wide settings back to DB (NOT engine-specific settings)
        # Engine settings are in the 'engines' table, not global_settings
        for category in ['engines', 'quality', 'languages']:
            if category in settings:
                self._insert_setting(category, settings[category])
        self.db.commit()

        return settings

    # NOTE: _merge_tts_engine_settings, _merge_stt_engine_settings, _merge_text_engine_settings,
    # and _merge_audio_engine_settings have been REMOVED.
    # Engine settings are now stored in the 'engines' table (Single Source of Truth).
    # Use EngineRepository for reading/writing engine settings.

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

    def get_engine_parameters(self, engine: str, engine_type: str = 'tts') -> Dict[str, Any]:
        """
        Get engine-specific parameters

        Reads from the engines table (Single Source of Truth).
        Falls back to engine.yaml defaults if not in engines table.

        Args:
            engine: Engine identifier (variantId like 'xtts:local' or base name like 'xtts')
            engine_type: Type of engine ('tts', 'stt', 'audio', 'text')

        Returns:
            Dictionary of engine parameters (temperature, speed, etc.)
            NOTE: Keys are snake_case (backend-consumed)
        """
        from db.engine_repository import EngineRepository
        import json

        engine_repo = EngineRepository(self.db)

        # Normalize to variant_id
        variant_id = engine

        # Primary: Read from engines table (SSOT)
        db_engine = engine_repo.get_by_id(variant_id)
        db_parameters = {}
        if db_engine and db_engine.get('parameters'):
            params = db_engine['parameters']
            if isinstance(params, str):
                db_parameters = json.loads(params)
            else:
                db_parameters = params

        # Fallback: Get defaults from engine.yaml metadata
        manager = self._get_engine_manager(engine_type)
        default_parameters = {}

        if manager:
            # Get metadata from DB (Single Source of Truth)
            metadata = manager.get_engine_metadata(engine)

            if metadata:
                yaml_config = metadata.get('config') or {}

                # Extract defaults from parameters schema (new format: config.parameters)
                parameters_schema = yaml_config.get('parameters') or {}
                for param_name, param_config in parameters_schema.items():
                    if isinstance(param_config, dict) and 'default' in param_config:
                        default_parameters[param_name] = param_config['default']

        # Merge: DB parameters override defaults
        final_parameters = {**default_parameters, **db_parameters}

        logger.debug(f"Loaded parameters for engine {engine}: {final_parameters}")
        return final_parameters

    def _get_engine_manager(self, engine_type: str):
        """Get the appropriate engine manager for the given type"""
        if engine_type == 'tts':
            from core.tts_engine_manager import get_tts_engine_manager
            return get_tts_engine_manager()
        elif engine_type == 'stt':
            from core.stt_engine_manager import get_stt_engine_manager
            return get_stt_engine_manager()
        elif engine_type == 'text':
            from core.text_engine_manager import get_text_engine_manager
            return get_text_engine_manager()
        elif engine_type == 'audio':
            from core.audio_engine_manager import get_audio_engine_manager
            return get_audio_engine_manager()
        return None

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

            constraints = None

            # Check DB first (Single Source of Truth)
            metadata = tts_manager.get_engine_metadata(engine)
            if metadata:
                constraints = metadata.get('constraints') or {}
            else:
                # Check database for other variants
                try:
                    from db.engine_repository import EngineRepository
                    engine_repo = EngineRepository(self.db)
                    db_engines = engine_repo.get_by_base_name(engine)
                    if db_engines:
                        # Use first found (constraints are same for all variants)
                        # Docker engines don't have constraints yet, use default
                        constraints = {}
                        logger.debug(f"Found Docker engine '{engine}' in DB")
                except Exception as db_err:
                    logger.debug(f"DB lookup for engine '{engine}' failed: {db_err}")

            if constraints is not None:
                engine_max = constraints.get('max_text_length', 500)  # Default to 500
            else:
                logger.warning(f"Engine '{engine}' not found in metadata or DB, using default limit")
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
        Get list of enabled engine variant IDs for given type

        Args:
            engine_type: Type of engine ('tts', 'text', 'stt', 'audio')

        Returns:
            List of enabled variant IDs (e.g., ['xtts:local', 'chatterbox:local'])
        """
        settings = self.get_setting(engine_type)

        if not settings:
            return []

        variants = settings.get('variants', {})
        enabled = []

        for variant_id, variant_config in variants.items():
            # Default to True if 'enabled' key missing (engines are enabled by default)
            if variant_config.get('enabled', True):
                enabled.append(variant_id)

        return enabled

    def is_engine_enabled(self, engine_name: str, engine_type: str = 'tts') -> bool:
        """
        Check if specific engine variant is enabled

        Reads from the engines table (Single Source of Truth).
        Engines are enabled by default if not found in DB.

        Args:
            engine_name: Variant ID (e.g., 'xtts:local') or base name for backwards compatibility
            engine_type: Type of engine ('tts', 'text', 'stt', 'audio')

        Returns:
            True if enabled (or not found in DB), False if explicitly disabled
        """
        from db.engine_repository import EngineRepository

        engine_repo = EngineRepository(self.db)

        # Try direct lookup first (for variant IDs like 'xtts:local')
        engine = engine_repo.get_by_id(engine_name)
        if engine:
            return engine.get('enabled', True)

        # For backwards compatibility: if engine_name is a base name,
        # try with ':local' suffix
        base_name, _ = parse_variant_id(engine_name)
        variant_id = f"{base_name}:local"
        engine = engine_repo.get_by_id(variant_id)
        if engine:
            return engine.get('enabled', True)

        # Default to True if not found (engines are enabled by default)
        return True

    def is_variant_enabled(self, variant_id: str, engine_type: str = 'tts') -> bool:
        """
        Check if specific engine variant is enabled

        Reads from the engines table (Single Source of Truth).

        Args:
            variant_id: Variant ID (e.g., 'xtts:local', 'xtts:docker:local')
            engine_type: Type of engine ('tts', 'text', 'stt', 'audio')

        Returns:
            True if enabled, False if disabled
        """
        # Delegate to is_engine_enabled which reads from engines table
        return self.is_engine_enabled(variant_id, engine_type)

    def set_engine_enabled(self, engine_name: str, enabled: bool, engine_type: str = 'tts') -> bool:
        """
        Enable or disable an engine variant

        Writes to the engines table (Single Source of Truth).

        Behavior:
        - Disabling a default engine: clears the default (no default for this type)
        - Enabling when no default exists: sets this engine as default

        Args:
            engine_name: Variant ID (e.g., 'xtts:local') or base name
            enabled: True to enable, False to disable
            engine_type: Type of engine ('tts', 'text', 'stt', 'audio')

        Returns:
            True if successful

        Raises:
            ValueError: If engine not found
        """
        from db.engine_repository import EngineRepository

        engine_repo = EngineRepository(self.db)

        # Check if engine exists
        engine = engine_repo.get_by_id(engine_name)
        if not engine:
            raise ValueError(f"Engine '{engine_name}' not found in database")

        was_default = engine.get('is_default', False)

        if not enabled:
            # DISABLING: If this is the default, clear the default
            if was_default:
                engine_repo.clear_default(engine_type)
                logger.info(f"Cleared default {engine_type} engine (was '{engine_name}')")

        # Update enabled flag in engines table
        engine_repo.set_enabled(engine_name, enabled)

        if enabled:
            # ENABLING: If no default exists, set this as default
            current_default = engine_repo.get_default(engine_type)
            if not current_default:
                engine_repo.set_default(engine_name)
                logger.info(f"Auto-set '{engine_name}' as default {engine_type} engine (first enabled)")

        logger.info(f"Variant '{engine_name}' ({engine_type}) {'enabled' if enabled else 'disabled'}")
        return True

    def set_variant_enabled(self, variant_id: str, enabled: bool, engine_type: str = 'tts') -> bool:
        """
        Enable or disable an engine variant

        Args:
            variant_id: Variant ID (e.g., 'xtts:local', 'xtts:docker:local')
            enabled: True to enable, False to disable
            engine_type: Type of engine ('tts', 'text', 'stt', 'audio')

        Returns:
            True if successful

        Raises:
            ValueError: If trying to disable default engine
        """
        return self.set_engine_enabled(variant_id, enabled, engine_type)

    def get_engine_runner(self, engine_name: str, engine_type: str = 'tts') -> str:
        """
        Get the runner assignment for a specific engine.

        Args:
            engine_name: Engine identifier
            engine_type: Type of engine ('tts', 'text', 'stt', 'audio')

        Returns:
            Runner ID (e.g., 'local', 'docker:local'), defaults to 'local'
        """
        settings = self.get_setting(engine_type)
        if not settings:
            return 'local'

        engines = settings.get('engines', {})
        engine_config = engines.get(engine_name, {})

        return engine_config.get('runner', 'local')

    def set_engine_runner(self, engine_name: str, runner_id: str, engine_type: str = 'tts') -> bool:
        """
        Set the runner for a specific engine.

        Args:
            engine_name: Engine identifier
            runner_id: Runner ID (e.g., 'local', 'docker:local')
            engine_type: Type of engine ('tts', 'text', 'stt', 'audio')

        Returns:
            True if successful
        """
        settings_key = engine_type
        settings = self.get_setting(settings_key)

        if not settings:
            logger.error(f"Settings for '{settings_key}' not found")
            return False

        # Get or create engines dict
        if 'engines' not in settings:
            settings['engines'] = {}
        engines = settings['engines']

        # Create engine entry if it doesn't exist
        if engine_name not in engines:
            engines[engine_name] = {'enabled': True}

        # Update runner
        engines[engine_name]['runner'] = runner_id

        # Save settings
        self.update_setting(settings_key, settings)

        logger.info(f"Engine '{engine_name}' ({engine_type}) runner set to '{runner_id}'")
        return True

    def get_default_engine(self, engine_type: str) -> str:
        """
        Get the default engine name for a given type

        Reads from engines table (Single Source of Truth).

        Args:
            engine_type: Type of engine ('tts', 'stt', 'text', 'audio')

        Returns:
            Default engine variant_id or empty string if not found
        """
        from db.engine_repository import EngineRepository

        engine_repo = EngineRepository(self.db)

        # Get default engine from engines table
        default_engine = engine_repo.get_default(engine_type)
        if default_engine:
            return default_engine['variant_id']

        return ''

    def get_default_model_for_engine(self, engine_name: str, engine_type: str) -> str:
        """
        Get the default model for a specific engine variant

        Reads from the engines table (Single Source of Truth).

        Args:
            engine_name: Variant ID (e.g., 'xtts:local') or base name
            engine_type: Type of engine ('tts', 'stt', 'audio')

        Returns:
            Default model name or empty string if not found
        """
        from db.engine_model_repository import EngineModelRepository

        model_repo = EngineModelRepository(self.db)

        # Get default model from engine_models table (SSOT for models)
        default_model = model_repo.get_default_model(engine_name)
        return default_model or ''

    def get_variant_model(self, variant_id: str, engine_type: str) -> str:
        """
        Get the default model for a specific engine variant

        Args:
            variant_id: Variant ID (e.g., 'xtts:local', 'xtts:docker:local')
            engine_type: Type of engine ('tts', 'stt', 'audio')

        Returns:
            Default model name or empty string if not found
        """
        return self.get_default_model_for_engine(variant_id, engine_type)

    def set_default_engine(self, engine_type: str, engine_name: str) -> bool:
        """
        Set the default engine for a given type

        Uses engines table (Single Source of Truth) via EngineRepository.

        Args:
            engine_type: Type of engine ('tts', 'stt', 'text', 'audio')
            engine_name: Variant ID to set as default (empty string to clear default)

        Returns:
            True if successful

        Raises:
            ValueError: If engine is not enabled or not found
        """
        from db.engine_repository import EngineRepository

        engine_repo = EngineRepository(self.db)

        # Allow clearing the default engine (empty string or None)
        if not engine_name:
            # For TTS, we don't allow clearing the default (must always have one)
            if engine_type == 'tts':
                raise ValueError("TTS must have a default engine configured")

            # For other types (STT, Audio, Text), allow clearing the default
            # Clear default in engines table (engines remain enabled for selection)
            engine_repo.clear_default(engine_type)
            logger.info(f"Cleared default {engine_type} engine")
        else:
            # Check if engine exists in DB
            engine = engine_repo.get_by_id(engine_name)
            if not engine:
                # Engine not in database - raise error
                raise ValueError(f"Variant '{engine_name}' not found in {engine_type} engines")

            # For single-engine types (STT, Audio, Text), ensure selected engine is enabled
            # Other engines remain enabled (selectable) but won't be default
            # The set_default() call below handles the is_default flag
            if engine_type in ('stt', 'audio', 'text'):
                if not engine.get('enabled', True):
                    engine_repo.set_enabled(engine_name, True)
                    logger.info(f"Single-engine mode: enabled '{engine_name}' for {engine_type}")
            else:
                # For TTS (multi-engine), check if variant is enabled before setting as default
                if engine and not engine.get('enabled', True):
                    raise ValueError(f"Cannot set disabled variant '{engine_name}' as default")

            # Set as default in engines table (Single Source of Truth)
            if engine:
                engine_repo.set_default(engine_name)

        logger.info(f"Set default {engine_type} engine to '{engine_name}'")
        return True

    def set_default_model_for_engine(self, engine_name: str, model_name: str, engine_type: str) -> bool:
        """
        Set the default model for a specific engine variant

        Writes to the engine_models table (Single Source of Truth for models).

        Args:
            engine_name: Variant ID (e.g., 'xtts:local') or base name
            model_name: Model name to set as default
            engine_type: Type of engine ('tts', 'stt', 'audio')

        Returns:
            True if successful

        Raises:
            ValueError: If engine not found or model doesn't exist
        """
        from db.engine_model_repository import EngineModelRepository
        from db.engine_repository import EngineRepository

        engine_repo = EngineRepository(self.db)
        model_repo = EngineModelRepository(self.db)

        # Check if engine exists
        engine = engine_repo.get_by_id(engine_name)
        if not engine:
            raise ValueError(f"Engine '{engine_name}' not found in database")

        # Set default model in engine_models table (SSOT for models)
        if not model_repo.set_default_model(engine_name, model_name):
            raise ValueError(f"Model '{model_name}' not found for engine '{engine_name}'")

        logger.info(f"Set default model for {engine_type} variant '{engine_name}' to '{model_name}'")
        return True

    def set_variant_model(self, variant_id: str, model_name: str, engine_type: str) -> bool:
        """
        Set the default model for a specific engine variant

        Args:
            variant_id: Variant ID (e.g., 'xtts:local', 'xtts:docker:local')
            model_name: Model name to set as default
            engine_type: Type of engine ('tts', 'stt', 'audio')

        Returns:
            True if successful
        """
        return self.set_default_model_for_engine(variant_id, model_name, engine_type)

    def get_engine_language(self, engine_name: str, engine_type: str = 'tts') -> str:
        """
        Get the default language for an engine variant

        Reads from the engines table (Single Source of Truth).

        Args:
            engine_name: Variant ID (e.g., 'xtts:local') or base name
            engine_type: Type of engine (currently only 'tts' uses language)

        Returns:
            Default language code or 'en' if not found
        """
        from db.engine_repository import EngineRepository

        engine_repo = EngineRepository(self.db)

        engine = engine_repo.get_by_id(engine_name)
        if engine and engine.get('default_language'):
            return engine['default_language']

        return 'en'

    def set_engine_language(self, engine_name: str, language: str, engine_type: str = 'tts') -> bool:
        """
        Set the default language for an engine variant

        Writes to the engines table (Single Source of Truth).

        Args:
            engine_name: Variant ID (e.g., 'xtts:local') or base name
            language: Language code (e.g., 'de', 'en')
            engine_type: Type of engine (currently only 'tts' uses language)

        Returns:
            True if successful

        Raises:
            ValueError: If engine not found in database
        """
        from db.engine_repository import EngineRepository

        engine_repo = EngineRepository(self.db)

        # Check if engine exists
        engine = engine_repo.get_by_id(engine_name)
        if not engine:
            raise ValueError(f"Engine '{engine_name}' not found in database")

        # Update language in engines table
        engine_repo.update_settings(engine_name, default_language=language)

        logger.info(f"Set default language for {engine_type} engine '{engine_name}' to '{language}'")
        return True

    def set_engine_parameters(self, engine_name: str, parameters: Dict[str, Any], engine_type: str = 'tts') -> bool:
        """
        Set parameters for an engine variant

        Writes to the engines table (Single Source of Truth).

        Args:
            engine_name: Variant ID (e.g., 'xtts:local') or base name
            parameters: Parameters dict to set
            engine_type: Type of engine

        Returns:
            True if successful

        Raises:
            ValueError: If engine not found in database
        """
        from db.engine_repository import EngineRepository

        engine_repo = EngineRepository(self.db)

        # Check if engine exists
        engine = engine_repo.get_by_id(engine_name)
        if not engine:
            raise ValueError(f"Engine '{engine_name}' not found in database")

        # Update parameters in engines table
        engine_repo.update_settings(engine_name, parameters=parameters)

        logger.info(f"Set parameters for {engine_type} engine '{engine_name}'")
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
        Check if engine variant should be kept running (exempt from auto-stop)

        Reads from the engines table (Single Source of Truth).

        Args:
            engine_name: Variant ID (e.g., 'xtts:local') or base name
            engine_type: Type of engine ('tts', 'stt', 'text', 'audio')

        Returns:
            True if engine should stay running, False otherwise
        """
        from db.engine_repository import EngineRepository

        engine_repo = EngineRepository(self.db)

        engine = engine_repo.get_by_id(engine_name)
        if engine:
            return engine.get('keep_running', False)

        return False

    def get_variant_keep_running(self, variant_id: str, engine_type: str) -> bool:
        """
        Check if engine variant should be kept running

        Args:
            variant_id: Variant ID (e.g., 'xtts:local', 'xtts:docker:local')
            engine_type: Type of engine ('tts', 'stt', 'text', 'audio')

        Returns:
            True if variant should stay running, False otherwise
        """
        return self.get_engine_keep_running(variant_id, engine_type)

    def set_engine_keep_running(self, engine_name: str, keep_running: bool, engine_type: str) -> None:
        """
        Set keepRunning flag for a specific engine variant

        Writes to the engines table (Single Source of Truth).
        Notifies the appropriate engine manager to sync the runtime state.

        Args:
            engine_name: Variant ID (e.g., 'xtts:local') or base name
            keep_running: True to keep engine running, False to allow auto-stop
            engine_type: Type of engine ('tts', 'stt', 'audio', 'text')

        Raises:
            ValueError: If engine not found in database
        """
        from db.engine_repository import EngineRepository

        engine_repo = EngineRepository(self.db)

        # Check if engine exists
        engine = engine_repo.get_by_id(engine_name)
        if not engine:
            raise ValueError(f"Engine '{engine_name}' not found in database")

        # Update keep_running in engines table
        engine_repo.set_keep_running(engine_name, keep_running)

        # Notify engine manager to sync runtime state
        manager = self._get_engine_manager(engine_type)
        if manager and hasattr(manager, 'sync_keep_running_state'):
            try:
                # Pass full variant_id - manager tracks exemptions by variant_id
                manager.sync_keep_running_state(engine_name, keep_running)
                logger.info(f"Synced keepRunning state for '{engine_name}' ({engine_type}) to {keep_running}")
            except Exception as e:
                logger.warning(f"Could not sync keepRunning state to manager: {e}")

        logger.info(f"Variant '{engine_name}' ({engine_type}) keepRunning set to {keep_running}")

    def set_variant_keep_running(self, variant_id: str, keep_running: bool, engine_type: str) -> None:
        """
        Set keepRunning flag for a specific engine variant

        Args:
            variant_id: Variant ID (e.g., 'xtts:local', 'xtts:docker:local')
            keep_running: True to keep variant running, False to allow auto-stop
            engine_type: Type of engine ('tts', 'stt', 'audio', 'text')
        """
        self.set_engine_keep_running(variant_id, keep_running, engine_type)
