"""
TTS Manager - Factory and Registry for Multiple TTS Engines

Manages the lifecycle and switching between different TTS engines (XTTS, Dummy, and future engines).
Uses Singleton + Factory pattern for efficient engine management.
See ROADMAP.md for planned engine integrations.

Architecture:
    TTSManager (Singleton)
    ├── Engine Registry (class mapping)
    ├── Engine Cache (loaded instances)
    └── Active Engine tracking

Usage:
    from backend.services.tts_manager import get_tts_manager

    manager = get_tts_manager()

    engines = manager.list_available_engines()

    xtts = manager.initialize_engine('xtts', model_version='v2.0.2')

    engine = manager.get_engine('xtts')

    manager.switch_engine('dummy')

Author: Multi-TTS Engine Architecture
Date: 2025-10-15
"""
import os
from typing import Dict, List, Optional, Any, Type
from pathlib import Path
from loguru import logger

from .base_tts_engine import BaseTTSEngine
from .xtts_engine import XTTSEngine
from .dummy_engine import DummyEngine


class TTSManager:
    """
    TTS Engine Manager - Factory and Registry

    Manages multiple TTS engines with lazy loading, caching, and switching.
    Implements Singleton pattern to ensure single manager instance.

    Features:
    - Engine registry for pluggable backends
    - Lazy loading (engines loaded only when needed)
    - Instance caching (avoid reloading)
    - Active engine tracking
    - Thread-safe engine switching

    Attributes:
        _engine_classes: Registry of engine name -> class mapping
        _engines: Cache of loaded engine instances
        _active_engine: Name of currently active engine
        _default_engine: Fallback engine name
    """

    @staticmethod
    def _build_engine_registry() -> Dict[str, Type[BaseTTSEngine]]:
        """
        Build engine registry based on configuration

        The dummy engine is only included if ENABLE_DUMMY_TTS=1 is set.
        """
        engines = {
            'xtts': XTTSEngine,
        }

        if os.environ.get('ENABLE_DUMMY_TTS') == '1':
            engines['dummy'] = DummyEngine

        return engines

    _engine_classes: Dict[str, Type[BaseTTSEngine]] = _build_engine_registry()

    def __init__(self):
        """
        Initialize TTS Manager

        Note: Use get_tts_manager() instead of direct instantiation
        to ensure singleton pattern.
        """
        self._engines: Dict[str, BaseTTSEngine] = {}
        self._active_engine: Optional[str] = None
        self._default_engine: str = 'xtts'

        logger.info(
            f"TTSManager initialized with {len(self._engine_classes)} "
            f"available engines: {', '.join(self._engine_classes.keys())}"
        )

    def list_available_engines(self) -> List[str]:
        """
        Get list of all available engine names

        Returns:
            List of engine identifiers (e.g., ['xtts', 'dummy'])
        """
        return list(self._engine_classes.keys())

    def get_engine_info(self, engine_type: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Get metadata for all engines or specific engine

        Does NOT load models, uses class methods to get metadata.
        Useful for UI to show available engines without loading heavy models.

        Args:
            engine_type: Specific engine to query, or None for all engines

        Returns:
            List of engine info dictionaries with format:
            [{
                'name': str,
                'display_name': str,
                'supported_languages': List[str],
                'constraints': Dict,
                'default_parameters': Dict,
                'model_loaded': bool,
                'device': str
            }]
        """
        engine_types = [engine_type] if engine_type else self.list_available_engines()

        info_list = []
        for etype in engine_types:
            if etype not in self._engine_classes:
                logger.warning(f"Unknown engine type: {etype}")
                continue

            if etype in self._engines:
                info_list.append(self._engines[etype].get_info())
            else:
                engine_class = self._engine_classes[etype]
                engine_info = {
                    'name': engine_class.get_engine_name_static(),
                    'display_name': engine_class.get_display_name_static(),
                    'supported_languages': engine_class.get_supported_languages_static(),
                    'default_parameters': engine_class.get_default_parameters_static(),
                    'constraints': engine_class.get_generation_constraints_static(),
                    'model_loaded': False,
                    'device': 'cuda'
                }
                info_list.append(engine_info)

        return info_list

    def get_available_models(self, engine_type: str, models_base_path: Path) -> List[Dict[str, Any]]:
        """
        Get list of available models for a specific engine

        Args:
            engine_type: Engine identifier (e.g., 'xtts', 'dummy')
            models_base_path: Base path to models directory (e.g., backend/models/)

        Returns:
            List of model dictionaries with metadata

        Raises:
            ValueError: If engine_type is unknown

        Example:
            models = manager.get_available_models('xtts', Path('backend/models/'))
        """
        if engine_type not in self._engine_classes:
            available = ', '.join(self._engine_classes.keys())
            raise ValueError(
                f"Unknown engine type: '{engine_type}'. "
                f"Available engines: {available}"
            )

        engine_class = self._engine_classes[engine_type]
        return engine_class.get_available_models_static(models_base_path)

    def initialize_engine(
        self,
        engine_type: str,
        model_name: Optional[str] = None,
        models_base_path: Optional[Path] = None,
        force_reload: bool = False,
        **kwargs
    ) -> BaseTTSEngine:
        """
        Initialize and load a specific TTS engine with a specific model

        Uses lazy loading - creates engine only if not already cached.
        Pass force_reload=True to reload the engine from scratch.

        Args:
            engine_type: Engine identifier (e.g., 'xtts', 'dummy')
            model_name: Model name to load (e.g., 'v2.0.2', 'Heinzle')
            models_base_path: Base path to models directory (e.g., backend/models/)
            force_reload: Force reload even if already cached
            **kwargs: Engine-specific initialization parameters
                      (e.g., device='cuda', lowvram=True)

        Returns:
            Initialized engine instance

        Raises:
            ValueError: If engine_type is unknown or model not found
            RuntimeError: If engine initialization fails

        Example:
            engine = manager.initialize_engine(
                'xtts',
                model_name='v2.0.2',
                models_base_path=Path('backend/models'),
                device='cuda',
                lowvram=True
            )

            engine = manager.initialize_engine(
                'xtts',
                models_dir=Path('backend/models/v2.0.2'),
                device='cuda'
            )
        """
        if engine_type not in self._engine_classes:
            available = ', '.join(self._engine_classes.keys())
            raise ValueError(
                f"Unknown engine type: '{engine_type}'. "
                f"Available engines: {available}"
            )

        if engine_type in self._engines and not force_reload:
            logger.info(f"Engine '{engine_type}' already initialized (using cached)")
            return self._engines[engine_type]

        if force_reload and engine_type in self._engines:
            logger.info(f"Force reloading engine '{engine_type}'")
            self.unload_engine(engine_type)

        logger.info(f"Initializing engine '{engine_type}' with params: {kwargs}")

        try:
            engine_class = self._engine_classes[engine_type]

            models_dir = kwargs.pop('models_dir', None)

            if models_dir is None and model_name and models_base_path:
                models_dir = models_base_path / engine_type / model_name
                logger.info(f"Resolved model path: {models_dir}")

                if not models_dir.exists():
                    raise ValueError(
                        f"Model '{model_name}' not found for engine '{engine_type}' "
                        f"at path: {models_dir}"
                    )

            engine = engine_class(**kwargs)

            if models_dir is not None:
                logger.info(f"Loading model for engine '{engine_type}'")
                engine.load_model(models_dir)
                logger.info(f"Model loaded successfully for engine '{engine_type}'")

            self._engines[engine_type] = engine

            if self._active_engine is None:
                self._active_engine = engine_type
                logger.info(f"Set '{engine_type}' as active engine")

            logger.info(f"Engine '{engine_type}' initialized successfully")
            return engine

        except Exception as e:
            logger.error(f"Failed to initialize engine '{engine_type}': {e}")
            raise RuntimeError(f"Engine initialization failed: {e}") from e

    def get_engine(self, engine_type: Optional[str] = None) -> BaseTTSEngine:
        """
        Get an engine instance (cached or active)

        Args:
            engine_type: Specific engine to get, or None for active engine

        Returns:
            Engine instance

        Raises:
            ValueError: If engine not initialized or unknown type

        Example:
            engine = manager.get_engine()

            xtts = manager.get_engine('xtts')
        """
        if engine_type is None:
            if self._active_engine is None:
                logger.info(f"No active engine, initializing default: {self._default_engine}")
                return self.initialize_engine(self._default_engine)

            engine_type = self._active_engine

        if engine_type not in self._engines:
            raise ValueError(
                f"Engine '{engine_type}' not initialized. "
                f"Call initialize_engine('{engine_type}') first."
            )

        return self._engines[engine_type]

    def switch_engine(self, engine_type: str) -> None:
        """
        Switch the active engine

        The engine must be initialized first via initialize_engine().

        Args:
            engine_type: Engine to switch to

        Raises:
            ValueError: If engine not initialized

        Example:
            manager.initialize_engine('dummy')
            manager.switch_engine('dummy')

            engine = manager.get_engine()
        """
        if engine_type not in self._engines:
            raise ValueError(
                f"Cannot switch to '{engine_type}': not initialized. "
                f"Call initialize_engine('{engine_type}') first."
            )

        old_engine = self._active_engine
        self._active_engine = engine_type

        logger.info(f"Switched active engine: {old_engine} → {engine_type}")

    def unload_engine(self, engine_type: str) -> None:
        """
        Unload an engine and free resources

        Args:
            engine_type: Engine to unload

        Example:
            manager.unload_engine('xtts')
        """
        if engine_type not in self._engines:
            logger.warning(f"Engine '{engine_type}' not loaded, nothing to unload")
            return

        engine = self._engines[engine_type]

        engine.unload_model()

        del self._engines[engine_type]

        if self._active_engine == engine_type:
            self._active_engine = None
            logger.info("Active engine was unloaded, cleared active engine")

        logger.info(f"Engine '{engine_type}' unloaded and removed from cache")

    def unload_all_engines(self) -> None:
        """
        Unload all engines and free all resources

        Useful for cleanup or resetting the manager state.

        Example:
            manager.unload_all_engines()
        """
        engine_types = list(self._engines.keys())

        for engine_type in engine_types:
            self.unload_engine(engine_type)

        logger.info(f"All engines unloaded ({len(engine_types)} engines)")

    def get_active_engine_name(self) -> Optional[str]:
        """
        Get the name of the currently active engine

        Returns:
            Active engine name or None if no engine active
        """
        return self._active_engine

    def is_engine_loaded(self, engine_type: str) -> bool:
        """
        Check if an engine is loaded in cache

        Args:
            engine_type: Engine to check

        Returns:
            True if loaded, False otherwise
        """
        return engine_type in self._engines

    def get_loaded_engines(self) -> List[str]:
        """
        Get list of currently loaded engine names

        Returns:
            List of engine names
        """
        return list(self._engines.keys())

    def __repr__(self) -> str:
        """String representation"""
        loaded = ', '.join(self._engines.keys()) or 'none'
        return (
            f"<TTSManager "
            f"available={len(self._engine_classes)} "
            f"loaded={len(self._engines)} ({loaded}) "
            f"active={self._active_engine}>"
        )



_tts_manager: Optional[TTSManager] = None


def get_tts_manager() -> TTSManager:
    """
    Get or create the global TTSManager singleton instance

    This is the recommended way to access the TTSManager.
    Ensures only one manager instance exists across the application.

    Returns:
        TTSManager singleton instance

    Example:
        from backend.services.tts_manager import get_tts_manager

        manager = get_tts_manager()
        engines = manager.list_available_engines()
    """
    global _tts_manager

    if _tts_manager is None:
        _tts_manager = TTSManager()

    return _tts_manager


def reset_tts_manager() -> None:
    """
    Reset the TTSManager singleton (for testing)

    WARNING: This will unload all engines and reset the manager.
    Only use in test scenarios or explicit cleanup.
    """
    global _tts_manager

    if _tts_manager is not None:
        _tts_manager.unload_all_engines()
        _tts_manager = None
        logger.info("TTSManager singleton reset")
