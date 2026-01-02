"""
Base Engine Manager - Generic engine process management

Provides common functionality for all engine types (TTS, STT, Text, Audio):
- Process lifecycle (start/stop engine servers)
- HTTP communication (REST API clients)
- Health monitoring
- Port management
- Auto-discovery integration

This is an abstract base class. Subclasses implement engine-type-specific
API calls (e.g., TTSEngineManager.generate_with_engine()).

Author: Multi-Engine Architecture Refactoring
Date: 2025-11-23
"""

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Dict, List, Optional, Any, Set
from datetime import datetime, timezone
import socket
import asyncio
import httpx
from loguru import logger

from services.event_broadcaster import emit_engine_started, emit_engine_stopped, emit_engine_starting, emit_engine_stopping, emit_engine_error, emit_engine_model_loaded, safe_broadcast
from core.engine_runner import EngineEndpoint
from core.engine_runner_registry import get_engine_runner_registry
from core.engine_exceptions import EngineHostUnavailableError


class EngineStartupCancelledError(Exception):
    """Raised when engine startup is cancelled (e.g., user stopped engine during startup).

    This is NOT an error condition - it signals intentional cancellation and
    should not emit error events or error responses.
    """
    pass


def parse_variant_id(variant_id: str) -> tuple[str, str]:
    """
    Parse a variant_id into engine_name and runner_id.

    Args:
        variant_id: e.g., 'xtts', 'xtts:local' or 'xtts:docker:local'

    Returns:
        Tuple of (engine_name, runner_id)
        - Plain engine names (no ':') return (engine_name, 'local')
        - Variant IDs return (base_engine_name, runner_id)
    """
    parts = variant_id.split(':', 1)
    if len(parts) < 2:
        # Plain engine name, assume local runner
        return variant_id, 'local'
    return parts[0], parts[1]


# Global port registry shared by ALL engine managers to prevent port collisions
# This is necessary because each manager (TTS, STT, Text, Audio) runs independently
# and could otherwise assign the same port during concurrent startups
_global_used_ports: Set[int] = set()


class BaseEngineManager(ABC):
    """
    Abstract base class for engine managers

    Provides common process management, HTTP communication, and health monitoring
    for all engine types. Subclasses implement engine-type-specific operations:
    - TTSEngineManager: generate_with_engine() for text-to-speech
    - STTEngineManager: transcribe_with_engine() for speech-to-text
    - TextEngineManager: segment_with_engine() for text processing
    - AudioEngineManager: analyze_with_engine() for audio analysis

    Architecture:
        BaseEngineManager (Abstract)
        ├── Process Management (start/stop servers)
        ├── HTTP Communication (REST API clients)
        ├── Health Monitoring (track engine status)
        └── Port Management (auto-assign ports)

    Attributes:
        engine_type: Type identifier ('tts', 'stt', 'text', 'audio')
        engines_base_path: Path to engines directory
        engine_endpoints: Running engine endpoints (subprocess and Docker)
        engine_ports: Assigned ports for each engine
        active_engine: Currently loaded engine name
        http_client: Async HTTP client for engine communication
    """

    def __init__(self, engines_base_path: Path, engine_type: str):
        """
        Initialize engine manager

        Args:
            engines_base_path: Path to engines directory (e.g., backend/engines/tts/)
            engine_type: Type identifier ('tts', 'stt', 'text', 'audio')
        """
        self.engine_type = engine_type
        self.engines_base_path = engines_base_path

        # Engine tracking (all keyed by variant_id, e.g., 'xtts:local', 'xtts:docker:local')
        self.engine_ports: Dict[str, int] = {}  # variant_id -> port
        self.active_engine: Optional[str] = None  # Currently active variant_id

        # Lifecycle status tracking (keyed by variant_id)
        self._starting_engines: Set[str] = set()  # variant_ids currently starting
        self._stopping_engines: Set[str] = set()  # variant_ids currently stopping

        # Auto-stop configuration (keyed by variant_id)
        self._last_activity: Dict[str, datetime] = {}  # variant_id -> last activity time
        self._inactivity_timeout: int = self._load_inactivity_timeout()  # Load from settings
        self._exempt_from_auto_stop: Set[str] = set()  # variant_ids exempt from auto-stop (keepRunning)

        # HTTP client (timeout for long operations)
        from config import ENGINE_HTTP_TIMEOUT
        self.http_client = httpx.AsyncClient(timeout=float(ENGINE_HTTP_TIMEOUT))

        # Runner registry for pluggable engine execution (local subprocess, Docker, remote)
        self.runner_registry = get_engine_runner_registry()
        self.engine_endpoints: Dict[str, EngineEndpoint] = {}  # variant_id -> endpoint

        # Discovery happens in main.py during async startup
        # discover_local_engines() is called there and results passed to _register_local_engines_in_db()

        # Note: Engine registration moved to main.py for async model discovery
        # _register_local_engines_in_db() and _sync_uninstalled_engines() are
        # now called from register_engines_with_model_discovery() during startup

        # Load keep running settings from DB
        self.sync_keep_running_from_settings()

        # Count installed engines from DB (single source of truth)
        try:
            from db.database import get_db_connection_simple
            from db.engine_repository import EngineRepository
            conn = get_db_connection_simple()
            repo = EngineRepository(conn)
            installed = repo.get_installed(self.engine_type)
            conn.close()

            subprocess_count = sum(1 for e in installed if e.get('host_id') == 'local')
            docker_count = len(installed) - subprocess_count

            logger.success(
                f"{self.__class__.__name__} initialized with "
                f"{len(installed)} installed engines "
                f"({subprocess_count} subprocess, {docker_count} Docker): "
                f"{', '.join(e['variant_id'] for e in installed)}"
            )
        except Exception as e:
            logger.warning(f"Could not count installed engines: {e}")

    @abstractmethod
    def discover_local_engines(self) -> Dict[str, Dict[str, Any]]:
        """
        Discover engines from engines_base_path

        Must be implemented by subclass to use appropriate discovery class.
        Returns discovered engine metadata directly (not stored in instance).

        Example (TTS):
            from core.tts_engine_discovery import TTSEngineDiscovery
            discovery = TTSEngineDiscovery(self.engines_base_path)
            return discovery.discover_all()

        Returns:
            Dictionary mapping engine_name -> engine_metadata
        """
        pass

    def _register_local_engines_in_db(self, discovered_engines: Dict[str, Dict[str, Any]]) -> None:
        """
        Register newly installed local engines in the engines table.

        Args:
            discovered_engines: Dictionary from discover_local_engines()

        Only creates/updates entries when installation status changes:
        - New engine (not in DB) → INSERT with defaults
        - Reinstalled engine (in DB but is_installed=false) → UPDATE is_installed=true
        - Already installed (in DB and is_installed=true) → NO CHANGES

        This preserves user settings (keepRunning, defaultModel, parameters, etc.)
        across backend restarts.
        """
        try:
            from db.database import get_db_connection_simple
            from db.engine_repository import EngineRepository

            conn = get_db_connection_simple()
            engine_repo = EngineRepository(conn)

            new_count = 0
            reinstall_count = 0
            updated_count = 0

            # Check if there's already an enabled engine of this type
            def has_enabled_engine() -> bool:
                enabled = engine_repo.get_enabled(self.engine_type)
                return len(enabled) > 0

            for engine_name, metadata in discovered_engines.items():
                variant_id = f"{engine_name}:local"

                try:
                    existing_engine = engine_repo.get_by_id(variant_id)

                    # Extract common metadata
                    # Use 'or' pattern to handle explicit None values
                    config = metadata.get('config') or {}
                    config_hash = metadata.get('config_hash')
                    constraints = metadata.get('constraints') or {}
                    capabilities = metadata.get('capabilities') or {}
                    display_name = metadata.get('display_name') or engine_name
                    supported_languages = metadata.get('supported_languages') or []

                    # Extract default parameters from parameters section
                    parameters_schema = config.get('parameters') or {}
                    default_parameters = {}
                    for param_name, param_config in parameters_schema.items():
                        if 'default' in param_config:
                            default_parameters[param_name] = param_config['default']

                    if not existing_engine:
                        # NEW ENGINE: Insert with all defaults
                        is_installed = metadata.get('is_installed', True)

                        # Auto-enable first installed engine of this type
                        auto_enable = is_installed and not has_enabled_engine()

                        engine_repo.upsert(
                            variant_id=variant_id,
                            base_engine_name=engine_name,
                            engine_type=self.engine_type,
                            host_id="local",
                            source="local",
                            is_installed=is_installed,
                            is_default=auto_enable,
                            enabled=auto_enable,
                            display_name=display_name,
                            supported_languages=supported_languages,
                            requires_gpu=metadata.get('requires_gpu', False),
                            venv_path=str(metadata.get('venv_path')) if metadata.get('venv_path') else None,
                            server_script=str(metadata.get('server_script')) if metadata.get('server_script') else None,
                            parameters=default_parameters if default_parameters else None,
                            constraints=constraints if constraints else None,
                            capabilities=capabilities if capabilities else None,
                            config=config if config else None,
                            config_hash=config_hash,
                        )
                        status = "installed" if is_installed else "available (not installed)"
                        if auto_enable:
                            status += ", auto-enabled as default"
                        logger.info(f"Registered new engine {variant_id} in DB ({status})")
                        new_count += 1

                    elif not existing_engine.get('is_installed') and metadata.get('is_installed', True):
                        # REINSTALLED ENGINE: VENV now exists, update all metadata
                        engine_repo.set_installed(variant_id, True)
                        engine_repo.update_system_metadata(
                            variant_id=variant_id,
                            display_name=display_name,
                            supported_languages=supported_languages,
                            constraints=constraints,
                            capabilities=capabilities,
                            config=config,
                            config_hash=config_hash,
                            parameters=default_parameters if default_parameters else None,
                        )

                        # Auto-enable if no other enabled engine exists
                        if not has_enabled_engine():
                            engine_repo.set_enabled(variant_id, True)
                            engine_repo.set_default(variant_id)
                            logger.info(f"Marked {variant_id} as reinstalled in DB (auto-enabled as default)")
                        else:
                            logger.info(f"Marked {variant_id} as reinstalled in DB (config updated)")
                        reinstall_count += 1

                    elif config_hash and existing_engine.get('config_hash') != config_hash:
                        # CONFIG CHANGED: Update system metadata, reset parameters to new defaults
                        engine_repo.update_system_metadata(
                            variant_id=variant_id,
                            display_name=display_name,
                            supported_languages=supported_languages,
                            constraints=constraints,
                            capabilities=capabilities,
                            config=config,
                            config_hash=config_hash,
                            parameters=default_parameters if default_parameters else None,
                        )
                        logger.info(f"Updated {variant_id} system metadata (config hash changed)")
                        updated_count += 1

                    # else: Already in correct state - no changes needed

                except Exception as e:
                    logger.error(f"Failed to register local engine {variant_id} in DB: {e}")

            conn.close()

            if new_count > 0 or reinstall_count > 0 or updated_count > 0:
                logger.info(f"Engine registration: {new_count} new, {reinstall_count} reinstalled, {updated_count} updated ({self.engine_type})")

        except Exception as e:
            logger.error(f"Failed to register local engines in DB: {e}")
            # Don't fail startup if DB registration fails

    def _sync_uninstalled_engines(self) -> None:
        """
        Mark engines as uninstalled if VENV no longer exists.

        Called during startup to detect user-deleted subprocess engines.
        Only affects local subprocess engines (not Docker).
        """
        try:
            from db.database import get_db_connection_simple
            from db.engine_repository import EngineRepository

            conn = get_db_connection_simple()
            engine_repo = EngineRepository(conn)

            # Get all installed local engines from DB (host_id="local")
            installed_engines = engine_repo.get_installed(self.engine_type)
            uninstalled_count = 0

            for engine in installed_engines:
                # Only check local subprocess engines
                if engine.get('host_id') != 'local':
                    continue

                venv_path = engine.get('venv_path')
                if not venv_path:
                    continue

                # Check if venv_path exists on filesystem
                venv_path_obj = Path(venv_path)
                if not venv_path_obj.exists():
                    variant_id = engine['variant_id']
                    engine_repo.set_installed(variant_id, False)
                    logger.info(f"Marked {variant_id} as uninstalled (VENV no longer exists)")
                    uninstalled_count += 1

            conn.close()

            if uninstalled_count > 0:
                logger.info(f"Synced {uninstalled_count} uninstalled engines ({self.engine_type})")

        except Exception as e:
            logger.error(f"Failed to sync uninstalled engines: {e}")
            # Don't fail startup if sync fails

    def get_engine_metadata(self, variant_id: str) -> Optional[Dict[str, Any]]:
        """
        Get engine metadata from database.

        Single source of truth for ALL engine lookups (subprocess and Docker).

        Args:
            variant_id: Full variant ID (e.g., 'xtts:local', 'debug-tts:docker:local')

        Returns:
            Metadata dict or None if not found. Dict contains:
            - name: Base engine name
            - display_name: Human-readable name
            - supported_languages: List of language codes
            - requires_gpu: Boolean
            - constraints: Dict (e.g., {'max_text_length': 400})
            - capabilities: Dict (e.g., {'voice_cloning': True})
            - config: Full engine.yaml content (dict)
            - models: List of model dicts (extracted from config)
            - venv_path: Path (subprocess only)
            - server_script: Path (subprocess only)
            - docker_image: str (docker only)
            - docker_tag: str (docker only)
            - is_installed: bool
            - enabled: bool
        """
        try:
            from db.database import get_db_connection_simple
            from db.engine_repository import EngineRepository

            conn = get_db_connection_simple()
            engine_repo = EngineRepository(conn)
            engine_data = engine_repo.get_by_id(variant_id)
            conn.close()

            if not engine_data:
                return None

            # Build normalized metadata dict
            # Use 'or {}' to handle both missing keys AND explicit None values from DB
            config = engine_data.get('config') or {}
            metadata = {
                'name': engine_data.get('base_engine_name'),
                'display_name': engine_data.get('display_name'),
                'supported_languages': engine_data.get('supported_languages') or [],
                'requires_gpu': engine_data.get('requires_gpu') or False,
                'constraints': engine_data.get('constraints') or {},
                'capabilities': engine_data.get('capabilities') or {},
                'config': config,
                'is_installed': engine_data.get('is_installed') or False,
                'enabled': engine_data.get('enabled') or False,
                'default_language': engine_data.get('default_language'),
                # Note: default_model_name is now in engine_models table (Migration 012)
                # Use EngineModelRepository.get_default_model() instead
            }

            # Add subprocess-specific fields if present
            if engine_data.get('venv_path'):
                metadata['venv_path'] = Path(engine_data['venv_path'])
            if engine_data.get('server_script'):
                metadata['server_script'] = Path(engine_data['server_script'])

            # Add Docker-specific fields if present
            if engine_data.get('docker_image'):
                metadata['docker_image'] = engine_data['docker_image']
            if engine_data.get('docker_tag'):
                metadata['docker_tag'] = engine_data['docker_tag']

            return metadata

        except Exception as e:
            logger.error(f"Failed to get engine metadata for {variant_id}: {e}")
            return None

    def list_installed_engines(self, enabled_only: bool = False) -> List[str]:
        """
        List all installed engine variant IDs from database.

        Args:
            enabled_only: If True, only return enabled engines

        Returns:
            List of variant IDs (e.g., ['xtts:local', 'chatterbox:local', 'debug-tts:docker:local'])
        """
        try:
            from db.database import get_db_connection_simple
            from db.engine_repository import EngineRepository

            conn = get_db_connection_simple()
            engine_repo = EngineRepository(conn)

            if enabled_only:
                engines = engine_repo.get_enabled(self.engine_type)
            else:
                engines = engine_repo.get_installed(self.engine_type)

            conn.close()

            return [engine['variant_id'] for engine in engines]

        except Exception as e:
            logger.error(f"Failed to list installed engines: {e}")
            return []

    def _load_inactivity_timeout(self) -> int:
        """
        Load inactivity timeout from settings

        Returns:
            Timeout in seconds (default: 300 = 5 minutes)
        """
        try:
            from services.settings_service import SettingsService
            from db.database import get_db_connection_simple

            conn = get_db_connection_simple()
            settings_service = SettingsService(conn)
            return settings_service.get_inactivity_timeout()
        except Exception as e:
            logger.warning(f"Could not load inactivity timeout from settings: {e}, using default (300s)")
            return 300

    def sync_inactivity_timeout_from_settings(self):
        """
        Synchronize inactivity timeout from settings

        Called when settings are updated to apply new timeout value.
        """
        old_timeout = self._inactivity_timeout
        self._inactivity_timeout = self._load_inactivity_timeout()

        if old_timeout != self._inactivity_timeout:
            logger.info(
                f"Inactivity timeout updated: {old_timeout}s → {self._inactivity_timeout}s "
                f"(engine_type={self.engine_type})"
            )

    def sync_keep_running_from_settings(self):
        """
        Synchronize keep running settings from database

        Loads all 'keepRunning' flags for engines of this type and updates
        the _exempt_from_auto_stop set accordingly.

        Called during:
        - Manager initialization (to load initial state)
        - Settings updates (when user changes keepRunning flag in UI)
        """
        try:
            from services.settings_service import SettingsService
            from db.database import get_db_connection_simple

            conn = get_db_connection_simple()
            settings_service = SettingsService(conn)

            # Clear current exemptions
            old_exempt = self._exempt_from_auto_stop.copy()
            self._exempt_from_auto_stop.clear()

            # Load keepRunning for all installed engines (subprocess + Docker)
            for variant_id in self.list_installed_engines():
                # Query DB with full variant_id (settings are stored per-variant)
                keep_running = settings_service.get_engine_keep_running(variant_id, self.engine_type)
                if keep_running:
                    # Track by variant_id directly
                    self._exempt_from_auto_stop.add(variant_id)

            # Log changes
            added = self._exempt_from_auto_stop - old_exempt
            removed = old_exempt - self._exempt_from_auto_stop

            if added:
                logger.info(f"Engines marked as keep running: {', '.join(added)}")
            if removed:
                logger.info(f"Engines no longer keep running: {', '.join(removed)}")

        except Exception as e:
            logger.warning(f"Could not sync keep running settings: {e}")

    def sync_keep_running_state(self, variant_id: str, keep_running: bool):
        """
        Synchronize keep_running state for a single engine (called from settings service)

        This method is called when a user toggles the keepRunning flag in the UI.
        It immediately updates the manager's internal _exempt_from_auto_stop set
        without requiring a full settings reload.

        Args:
            variant_id: Engine variant identifier (e.g., 'xtts:local', 'xtts:docker:local')
            keep_running: New keep_running state
        """
        old_state = variant_id in self._exempt_from_auto_stop

        if keep_running:
            self._exempt_from_auto_stop.add(variant_id)
        else:
            self._exempt_from_auto_stop.discard(variant_id)

        # Only log if state actually changed
        if old_state != keep_running:
            action = "marked as keep running (will not auto-stop)" if keep_running else "no longer keep running (subject to auto-stop)"
            logger.info(f"Engine {variant_id} {action} (engine_type={self.engine_type})")

    # ========== Common Methods (All Engine Types) ==========

    def list_available_engines(self) -> List[str]:
        """
        Get list of enabled engine variant_ids (includes both subprocess and Docker)

        Filters by settings.{engine_type}.engines[engine].enabled flag.
        Engines are enabled by default if no settings exist.

        Returns:
            List of enabled engine variant_ids (e.g., ['xtts:local', 'debug-tts:docker:local'])
        """
        return self.list_installed_engines(enabled_only=True)

    def list_all_engines(self) -> List[str]:
        """
        Get list of ALL engine variant_ids (including disabled, subprocess + Docker)

        Returns:
            List of all installed engine variant_ids
        """
        return self.list_installed_engines(enabled_only=False)

    def is_engine_available(self, engine_name: str) -> bool:
        """
        Check if an engine is available (discovered AND enabled)

        Args:
            engine_name: Engine identifier to check

        Returns:
            True if engine is discovered and enabled, False otherwise
        """
        # Check if engine exists in DB (Single Source of Truth)
        metadata = self.get_engine_metadata(engine_name)
        if not metadata:
            return False

        # Then check if enabled
        available = self.list_available_engines()
        return engine_name in available

    def get_engine_info(self, engine_name: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Get metadata for all engines or specific engine

        Args:
            engine_name: Specific engine to query, or None for all engines

        Returns:
            List of engine info dictionaries with metadata:
            - name: Engine identifier
            - display_name: Human-readable name
            - version: Engine version
            - capabilities: Feature flags (hotswap, cloning, streaming)
            - constraints: Limits (max_length, sample_rate)
            - supported_languages: Language codes
            - is_enabled: Whether engine is enabled in settings
            - is_running: Whether engine server is active
            - port: HTTP port if running
        """
        from services.settings_service import SettingsService
        from db.database import get_db_connection_simple

        # Use list_all_engines() to include disabled engines
        engine_names = [engine_name] if engine_name else self.list_all_engines()

        # Get enabled status from settings
        try:
            conn = get_db_connection_simple()
            settings_service = SettingsService(conn)
        except Exception as e:
            logger.warning(f"Could not get settings service: {e}")
            settings_service = None

        info_list = []
        for ename in engine_names:
            # Parse variant ID to get base engine name (e.g., 'xtts:local' -> 'xtts')
            base_name, _ = parse_variant_id(ename)

            # Get metadata from DB (Single Source of Truth)
            metadata = self.get_engine_metadata(ename)
            if not metadata:
                logger.warning(f"Unknown engine: {ename}")
                continue

            # Check if engine is enabled
            is_enabled = True  # Default
            if settings_service:
                try:
                    is_enabled = settings_service.is_engine_enabled(ename, self.engine_type)
                except Exception as e:
                    logger.warning(f"Could not check enabled status for {ename}: {e}")

            info_list.append({
                'name': metadata.get('name') or base_name,
                'display_name': metadata.get('display_name') or base_name,
                'capabilities': metadata.get('capabilities') or {},
                'constraints': metadata.get('constraints') or {},
                'supported_languages': metadata.get('supported_languages') or [],
                'is_enabled': is_enabled,
                'is_running': self.is_engine_running(ename),
                'port': self.engine_ports.get(ename)
            })

        return info_list

    def get_available_models(self, engine_name: str) -> List[Dict[str, Any]]:
        """
        Get list of available models for a specific engine

        Args:
            engine_name: Engine identifier (e.g., 'xtts', 'whisper', 'spacy' or 'xtts:local')

        Returns:
            List of model dictionaries with metadata:
            - engine_model_name: Model identifier
            - display_name: Human-readable name
            - path: Path to model directory (if local)
            - exists: Whether model files exist (if local)

        Raises:
            ValueError: If engine_name is unknown
        """
        # Parse variant ID to get base engine name (e.g., 'xtts:local' -> 'xtts')
        base_name, _ = parse_variant_id(engine_name)

        # Get metadata from DB (Single Source of Truth)
        metadata = self.get_engine_metadata(engine_name)
        if not metadata:
            available = ', '.join(self.list_installed_engines())
            raise ValueError(
                f"Unknown {self.engine_type} engine: '{engine_name}'. "
                f"Available engines: {available}"
            )

        return metadata.get('models', [])

    def find_free_port(self, start: int = None) -> int:
        """
        Find available port starting from given port

        Scans sequentially from start port until finding an available port.
        Uses global registry to prevent port collisions between different
        engine managers (TTS, STT, Text, Audio) during concurrent startups.

        Args:
            start: Starting port number (default: from config)

        Returns:
            First available port number (also registered in global registry)

        Raises:
            RuntimeError: If no free ports available (port >= max port)
        """
        from config import ENGINE_PORT_START, ENGINE_PORT_MAX
        if start is None:
            start = ENGINE_PORT_START

        global _global_used_ports
        port = start
        while port < ENGINE_PORT_MAX:
            # Skip ports already claimed by other managers
            if port in _global_used_ports:
                port += 1
                continue

            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                try:
                    sock.bind(('127.0.0.1', port))
                    # Register port globally BEFORE returning to prevent race conditions
                    _global_used_ports.add(port)
                    logger.debug(f"Port {port} assigned to {self.engine_type} (global registry: {_global_used_ports})")
                    return port
                except OSError:
                    port += 1
        raise RuntimeError("No free ports available")

    # ========== Model Discovery Methods ==========

    async def start_engine_for_discovery(self, variant_id: str) -> int:
        """
        Start engine server WITHOUT loading a model (fast, for /models endpoint)

        Used for manual model discovery via /engines/{variant_id}/discover-models endpoint.
        Engine will auto-stop after inactivity timeout if not used for work.

        Supports both local subprocess engines and Docker engines.

        Args:
            variant_id: Variant identifier (e.g., 'xtts:local', 'debug-tts:docker:local')

        Returns:
            Port number the engine is listening on

        Raises:
            ValueError: If engine is unknown or disabled
            RuntimeError: If engine start fails or health check times out
        """
        # Parse variant_id to get base engine name and runner
        base_engine_name, runner_id = parse_variant_id(variant_id)

        # Get metadata from DB (Single Source of Truth)
        metadata = self.get_engine_metadata(variant_id)
        if not metadata:
            raise ValueError(f"Unknown engine: {variant_id}")

        # If engine is currently starting by another task, wait for it
        if variant_id in self._starting_engines:
            logger.debug(f"Engine {variant_id} already starting, waiting...")
            for _ in range(35):  # Wait up to 35s for start to complete
                await asyncio.sleep(1)
                if variant_id not in self._starting_engines:
                    break
            # Check if it's now running
            if variant_id in self.engine_ports:
                return self.engine_ports[variant_id]
            # If still not running, fall through to start it ourselves

        # If engine is already running, just return its port
        if variant_id in self.engine_ports:
            return self.engine_ports[variant_id]

        # Mark engine as starting
        self._starting_engines.add(variant_id)
        logger.debug(f"Engine {variant_id} marked as 'starting' (discovery)")

        try:
            # Find free port
            port = self.find_free_port()
            self.engine_ports[variant_id] = port

            # Get the runner from variant_id
            runner = self.runner_registry.get_runner_by_variant(variant_id)

            # Build config based on runner type (Docker vs subprocess)
            docker_image = metadata.get('docker_image')
            if docker_image:
                # Docker runner config
                from db.database import get_db_connection_simple
                from db.engine_host_repository import EngineHostRepository

                requires_gpu = metadata.get('requires_gpu', False)
                docker_tag = metadata.get('docker_tag', 'latest')

                # Load docker_volumes from engine_hosts table
                docker_volumes = {}
                try:
                    host_conn = get_db_connection_simple()
                    host_repo = EngineHostRepository(host_conn)
                    host_docker_volumes = host_repo.get_docker_volumes(runner_id)
                    host_conn.close()
                    if host_docker_volumes:
                        docker_volumes = host_docker_volumes
                except Exception as e:
                    logger.warning(f"Could not load docker_volumes for {runner_id}: {e}")

                config = {
                    'port': port,
                    'gpu': requires_gpu,
                    'docker_volumes': docker_volumes,
                    'image_tag': docker_tag,
                    'docker_image': docker_image,
                }
                logger.info(f"Starting {variant_id} for discovery via Docker (image: {docker_image}:{docker_tag})")
            else:
                # Local subprocess runner config
                venv_path = metadata.get('venv_path')
                server_script = metadata.get('server_script')

                if not venv_path or not server_script:
                    raise RuntimeError(f"Engine {variant_id} missing venv_path or server_script")

                config = {
                    'port': port,
                    'venv_path': venv_path,
                    'server_script': server_script,
                }
                logger.info(f"Starting {variant_id} for discovery via subprocess")

            # Start engine via runner
            endpoint = await runner.start(variant_id, self.engine_type, config)
            self.engine_endpoints[variant_id] = endpoint

            # Wait for health check (max 30s)
            logger.debug(f"Waiting for {variant_id} server (discovery)...")
            for attempt in range(30):
                await asyncio.sleep(1)

                try:
                    health = await self.health_check(variant_id)
                    if health.get('status') in ['ready', 'loading']:
                        logger.info(f"{variant_id} server ready for discovery on port {port}")

                        # NO model loading - that's the key difference from start_engine_server()

                        # Record activity for auto-stop
                        self.record_activity(variant_id)

                        # Remove from starting state
                        self._starting_engines.discard(variant_id)
                        logger.debug(f"Engine {variant_id} removed from 'starting' state (discovery)")

                        return port
                except asyncio.TimeoutError:
                    logger.debug(f"Health check timeout for {variant_id}")
                except Exception as e:
                    logger.debug(f"Health check failed for {variant_id}: {e}")

            # Timeout - cleanup
            self._starting_engines.discard(variant_id)
            await self.stop_engine_server(variant_id)
            raise RuntimeError(f"{variant_id} server failed to start within 30s")

        except Exception:
            self._starting_engines.discard(variant_id)
            raise

    async def fetch_models_from_engine(self, variant_id: str) -> List[Dict[str, Any]]:
        """
        Fetch available models from a running engine via /models endpoint

        Args:
            variant_id: Engine variant identifier (e.g., 'xtts:local')

        Returns:
            List of ModelInfo dictionaries from the engine

        Raises:
            RuntimeError: If engine not running or request fails
        """
        base_url = self.get_engine_base_url(variant_id)
        url = f"{base_url}/models"
        try:
            response = await self.http_client.get(url)
            response.raise_for_status()
        except httpx.RequestError as e:
            raise RuntimeError(f"HTTP request to {variant_id} failed: {e}")
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"Engine {variant_id} returned error {e.response.status_code}: {e.response.text[:200]}")

        try:
            data = response.json()
        except ValueError as e:
            raise RuntimeError(f"Invalid JSON response from {variant_id}: {e}")

        return data.get('models', [])

    async def discover_engine_models(self, variant_id: str) -> List[Dict[str, Any]]:
        """
        Discover models from an engine by starting it without loading a model.

        Starts the engine (without loading a model), fetches model info via /models,
        and returns the results. Engine will auto-stop after inactivity timeout.

        Note: Results are NOT cached in memory. The caller (API endpoint) is
        responsible for storing results in the engine_models table.

        Args:
            variant_id: Variant identifier (e.g., 'xtts:local', 'debug-tts:docker:local')

        Returns:
            List of ModelInfo dictionaries

        Raises:
            RuntimeError: If discovery fails
        """
        logger.debug(f"Discovering models for {variant_id}...")

        # Start engine without loading a model
        await self.start_engine_for_discovery(variant_id)

        # Fetch models via /models endpoint
        models = await self.fetch_models_from_engine(variant_id)

        logger.info(f"Discovered {len(models)} models for {variant_id}")
        return models

    async def start_engine_server(self, variant_id: str, model_name: str) -> int:
        """
        Start engine server and wait for health check

        Uses the runner specified in the variant_id (local subprocess or Docker container).

        Flow:
        1. Parse variant_id to get base_engine_name and runner_id
        2. Check if engine is enabled
        3. Mark as 'starting'
        4. Find free port
        5. Start engine via runner from variant_id
        6. Wait for health check (max 30s)
        7. Load model
        8. Mark as active, remove from 'starting'

        Args:
            variant_id: Variant identifier (e.g., 'xtts:local', 'xtts:docker:local')
            model_name: Model to load (e.g., 'v2.0.3')

        Returns:
            Port number the engine is listening on

        Raises:
            ValueError: If engine is unknown or disabled
            RuntimeError: If engine start fails or health check times out
        """
        # Parse variant_id to get base engine name and runner
        base_engine_name, runner_id = parse_variant_id(variant_id)

        # Check if engine exists and is enabled
        # Always use full variant_id for DB lookup (both local and Docker engines are stored with full variant_id)
        from db.database import get_db_connection_simple
        from db.engine_repository import EngineRepository

        try:
            conn = get_db_connection_simple()
            engine_repo = EngineRepository(conn)
            db_engine_data = engine_repo.get_by_id(variant_id)

            if db_engine_data:
                # Engine found in DB - check installed and enabled status
                if not db_engine_data.get('is_installed', True):
                    raise ValueError(f"Engine {variant_id} is not installed. Run setup script to install.")
                if not db_engine_data.get('enabled', True):
                    raise ValueError(f"Engine {variant_id} is disabled. Enable it in settings first.")
            else:
                # Not in DB - engine is unknown
                raise ValueError(f"Unknown engine: {variant_id}")
        except ValueError:
            raise
        except Exception as e:
            logger.warning(f"Could not check engine status for {variant_id}: {e}, proceeding with start")

        # Check host availability for Docker runners (fail-early)
        if runner_id != "local":
            from db.engine_host_repository import EngineHostRepository
            host_conn = get_db_connection_simple()
            host_repo = EngineHostRepository(host_conn)
            if not host_repo.is_host_available(runner_id):
                host_conn.close()
                self._starting_engines.discard(variant_id)
                raise EngineHostUnavailableError(
                    f"[ENGINE_HOST_UNAVAILABLE]host:{runner_id}"
                )
            host_conn.close()

        # Mark engine as starting
        self._starting_engines.add(variant_id)
        logger.debug(f"Engine {variant_id} marked as 'starting'")

        # Emit SSE event for immediate UI feedback
        try:
            asyncio.create_task(emit_engine_starting(self.engine_type, base_engine_name, variant_id=variant_id))
        except Exception as e:
            logger.warning(f"Failed to emit engine.starting event: {e}")

        try:
            # Get metadata from DB (Single Source of Truth)
            metadata = self.get_engine_metadata(variant_id)
            if not metadata:
                raise ValueError(f"Unknown engine: {variant_id}")

            # Find free port
            port = self.find_free_port()
            self.engine_ports[variant_id] = port

            # Get the runner from variant_id
            runner = self.runner_registry.get_runner_by_variant(variant_id)

            # Build config based on runner type (Docker vs subprocess)
            docker_image = metadata.get('docker_image')
            if docker_image:
                # Docker runner config
                from db.database import get_db_connection_simple
                from db.engine_host_repository import EngineHostRepository

                requires_gpu = metadata.get('requires_gpu', False)
                docker_tag = metadata.get('docker_tag', 'latest')

                # Load docker_volumes from engine_hosts table
                # This allows configurable sample/model paths per Docker host
                docker_volumes = {}
                try:
                    host_conn = get_db_connection_simple()
                    host_repo = EngineHostRepository(host_conn)
                    host_docker_volumes = host_repo.get_docker_volumes(runner_id)
                    host_conn.close()

                    if host_docker_volumes:
                        docker_volumes = host_docker_volumes
                        logger.debug(f"Loaded docker_volumes for {runner_id}: {docker_volumes}")
                except Exception as e:
                    logger.warning(f"Could not load docker_volumes for {runner_id}: {e}")

                config = {
                    'port': port,
                    'gpu': requires_gpu,
                    'docker_volumes': docker_volumes,  # Configurable mounts from engine_hosts
                    'image_tag': docker_tag,
                    'docker_image': docker_image,  # Full image name from DB (e.g., ghcr.io/.../debug-tts)
                }
                logger.info(f"Starting {variant_id} via Docker (runner: {runner_id}, gpu: {requires_gpu}, image: {docker_image}:{docker_tag})")
            else:
                # Local subprocess runner config
                venv_path = metadata.get('venv_path')
                server_script = metadata.get('server_script')

                if not venv_path or not server_script:
                    raise RuntimeError(f"Engine {variant_id} missing venv_path or server_script")

                config = {
                    'port': port,
                    'venv_path': venv_path,
                    'server_script': server_script,
                }
                logger.info(f"Starting {variant_id} via subprocess (runner: {runner_id})")

            # Start engine via runner
            endpoint = await runner.start(variant_id, self.engine_type, config)
            self.engine_endpoints[variant_id] = endpoint

            # Wait for health check (max 30s)
            logger.debug(f"Waiting for {variant_id} server to be ready...")
            for attempt in range(30):
                # Check if engine was stopped during startup (race condition protection)
                if variant_id in self._stopping_engines or variant_id not in self.engine_endpoints:
                    self._starting_engines.discard(variant_id)
                    logger.info(f"Engine {variant_id} was stopped during startup - aborting health check")
                    raise EngineStartupCancelledError(f"Engine {variant_id} was stopped during startup")

                await asyncio.sleep(1)

                try:
                    health = await self.health_check(variant_id)
                    if health.get('status') in ['ready', 'loading']:
                        logger.info(f"{variant_id} server ready on port {port}")

                        # Load model
                        await self._load_model(variant_id, model_name)

                        # Record activity (engine just started)
                        self.record_activity(variant_id)

                        self.active_engine = variant_id

                        # Remove from starting state
                        self._starting_engines.discard(variant_id)
                        logger.debug(f"Engine {variant_id} removed from 'starting' state")

                        # Get package version from health check for SSE event
                        package_version = health.get('packageVersion')

                        # Emit engine started event
                        await safe_broadcast(
                            emit_engine_started,
                            self.engine_type,
                            base_engine_name,
                            port,
                            version=package_version,
                            variant_id=variant_id,
                            event_description="engine.started"
                        )

                        return port
                except asyncio.TimeoutError:
                    logger.debug(f"Health check timeout for {variant_id}")
                except Exception as e:
                    logger.debug(f"Health check failed for {variant_id}: {e}")

            # Timeout - cleanup starting state before stopping
            self._starting_engines.discard(variant_id)
            logger.debug(f"Engine {variant_id} removed from 'starting' state (timeout)")
            await self.stop_engine_server(variant_id)
            error_msg = f"{variant_id} server failed to start within 30s"
            # Emit engine error event
            asyncio.create_task(safe_broadcast(
                emit_engine_error,
                self.engine_type,
                base_engine_name,
                error_msg,
                "Startup timeout",
                variant_id=variant_id,
                event_description="engine.error"
            ))
            raise RuntimeError(error_msg)

        except EngineStartupCancelledError:
            # Engine was stopped during startup - this is NOT an error
            # The stop_engine_server already emitted engine.stopped event
            # Just cleanup and re-raise (API will return error, but UI already shows stopped)
            self._starting_engines.discard(variant_id)
            logger.debug(f"Engine {variant_id} startup cancelled (user stopped during startup)")
            raise

        except Exception as e:
            # Any error during startup - cleanup starting state
            self._starting_engines.discard(variant_id)
            logger.debug(f"Engine {variant_id} removed from 'starting' state (error)")
            # Emit engine error event
            asyncio.create_task(safe_broadcast(
                emit_engine_error,
                self.engine_type,
                base_engine_name,
                str(e),
                "Startup error",
                variant_id=variant_id,
                event_description="engine.error"
            ))
            raise

    async def _load_model(self, variant_id: str, model_name: str):
        """
        Call engine's /load endpoint to load model

        Args:
            variant_id: Variant identifier (e.g., 'xtts:local')
            model_name: Model to load

        Raises:
            RuntimeError: If engine not running or model loading fails
        """
        base_url = self.get_engine_base_url(variant_id)
        url = f"{base_url}/load"

        logger.debug(f"Loading model {model_name} on {variant_id}...")

        # Note: CamelCaseModel accepts both snake_case and camelCase (populate_by_name=True)
        # Using camelCase here for consistency with JSON API convention
        try:
            response = await self.http_client.post(url, json={"engineModelName": model_name})
            response.raise_for_status()
        except httpx.RequestError as e:
            raise RuntimeError(f"HTTP request to {variant_id} failed: {e}")
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"Engine {variant_id} returned error {e.response.status_code}: {e.response.text[:200]}")

        try:
            result = response.json()
        except ValueError as e:
            raise RuntimeError(f"Invalid JSON response from {variant_id}: {e}")

        if result.get('status') != 'loaded':
            raise RuntimeError(f"Model loading failed: {result.get('error')}")

        logger.success(f"Model {model_name} loaded successfully on {variant_id}")

        # Emit model loaded event
        base_engine_name, _ = parse_variant_id(variant_id)
        await safe_broadcast(
            emit_engine_model_loaded,
            self.engine_type,
            base_engine_name,
            model_name,
            variant_id=variant_id,
            event_description="engine.model_loaded"
        )

    async def stop_engine_server(self, variant_id: str, timeout: int = 30):
        """
        Gracefully stop engine via runner (subprocess or Docker container)

        Flow:
        1. Parse variant_id to get base_engine_name and runner_id
        2. Mark as 'stopping'
        3. Send /shutdown request to engine (graceful)
        4. Stop via runner (handles subprocess termination or container stop)
        5. Cleanup port tracking, remove from 'stopping'

        Args:
            variant_id: Variant identifier (e.g., 'xtts:local', 'xtts:docker:local')
            timeout: Seconds to wait before force-kill (default: 30)
        """
        # Parse variant_id to get base engine name and runner
        base_engine_name, runner_id = parse_variant_id(variant_id)

        # Check if engine is running via runner or engine_endpoints
        # This supports both manager-started engines and discovered containers
        runner = self.runner_registry.get_runner_by_variant(variant_id)
        is_running_via_runner = runner and runner.is_running(variant_id)
        is_running_via_endpoints = variant_id in self.engine_endpoints

        if not is_running_via_runner and not is_running_via_endpoints:
            logger.warning(f"Engine {variant_id} not running")
            return

        # If running via runner but not in endpoints (discovered container),
        # get the endpoint from the runner
        if is_running_via_runner and not is_running_via_endpoints:
            endpoint = runner.get_endpoint(variant_id)
            if endpoint:
                self.engine_endpoints[variant_id] = endpoint
                logger.debug(f"Synced discovered endpoint for {variant_id}")

        # Mark engine as stopping
        self._stopping_engines.add(variant_id)
        logger.debug(f"Engine {variant_id} marked as 'stopping'")

        # Emit SSE event for immediate UI feedback
        try:
            asyncio.create_task(emit_engine_stopping(self.engine_type, base_engine_name, "manual", variant_id=variant_id))
        except Exception as e:
            logger.warning(f"Failed to emit engine.stopping event: {e}")

        try:
            # Try graceful shutdown via HTTP /shutdown endpoint
            try:
                base_url = self.get_engine_base_url(variant_id)
                if base_url:
                    from config import ENGINE_HEALTH_CHECK_TIMEOUT
                    url = f"{base_url}/shutdown"
                    await self.http_client.post(url, timeout=float(ENGINE_HEALTH_CHECK_TIMEOUT))
                    logger.debug(f"Sent shutdown request to {variant_id}")
            except Exception as e:
                # Expected if engine already stopped or shutting down
                logger.debug(f"Graceful shutdown request failed (expected during app shutdown): {e}")

            if runner and runner.is_running(variant_id):
                logger.debug(f"Stopping {variant_id} via runner ({runner_id})...")
                await runner.stop(variant_id)
                logger.info(f"{variant_id} server stopped via {runner_id}")

            # Cleanup endpoint
            self.engine_endpoints.pop(variant_id, None)

            # Cleanup port
            if variant_id in self.engine_ports:
                port = self.engine_ports[variant_id]
                del self.engine_ports[variant_id]
                # Release port from global registry
                global _global_used_ports
                _global_used_ports.discard(port)
                logger.debug(f"Port {port} released from {variant_id} (global registry: {_global_used_ports})")

            if self.active_engine == variant_id:
                self.active_engine = None

            # Emit engine stopped event (manual stop)
            await safe_broadcast(
                emit_engine_stopped,
                self.engine_type,
                base_engine_name,
                reason="manual",
                variant_id=variant_id,
                event_description="engine.stopped"
            )

        finally:
            # Always remove from stopping state, even on error
            self._stopping_engines.discard(variant_id)
            logger.debug(f"Engine {variant_id} removed from 'stopping' state")

    async def ensure_engine_ready(self, variant_id: str, model_name: str):
        """
        Ensure engine is running and has correct model loaded

        Handles:
        - Starting engine if not running
        - Switching engines if different engine active (stops old engine first)
        - Hotswapping model if same engine but different model (if supported)

        Args:
            variant_id: Variant identifier (e.g., 'xtts:local', 'xtts:docker:local')
            model_name: Model to load
        """
        # Parse variant_id to get base engine name
        base_engine_name, runner_id = parse_variant_id(variant_id)

        # For single-engine types (STT, Audio, Text): stop other running engines
        # For TTS (multi-engine): allow multiple engines to run in parallel
        # This matches the pattern in settings_service.py and api/engines.py
        if self.engine_type in ('stt', 'audio', 'text'):
            # Check if a different engine is running (check all installed engines)
            # Keep track of variant_id for proper stopping
            running_variants = []
            for installed_variant_id in self.list_installed_engines():
                installed_base_name, _ = parse_variant_id(installed_variant_id)
                if self.is_engine_running(installed_variant_id):
                    running_variants.append((installed_base_name, installed_variant_id))

            other_variants = [(base, vid) for base, vid in running_variants if base != base_engine_name]

            if other_variants:
                variant_ids_to_stop = [vid for _, vid in other_variants]
                logger.info(f"Switching engines: stopping {variant_ids_to_stop} to start {variant_id}")
                for _, other_variant_id in other_variants:
                    # Stop using the actual variant_id (could be local or docker)
                    await self.stop_engine_server(other_variant_id)

        # Engine not running - start it
        if not self.is_engine_running(variant_id):
            logger.debug(f"Engine {variant_id} not running, starting...")
            await self.start_engine_server(variant_id, model_name)
            return

        # Check current model
        health = await self.health_check(variant_id)
        current_model = health.get('currentEngineModel')
        status = health.get('status')

        # Engine is currently loading a model - wait for it to complete
        if status == 'loading':
            logger.debug(f"Engine {variant_id} is loading model, waiting for completion...")
            for _ in range(300):  # 5 min max (matches model loading timeout)
                await asyncio.sleep(1)
                health = await self.health_check(variant_id)
                status = health.get('status')
                if status == 'ready':
                    current_model = health.get('currentEngineModel')
                    logger.debug(f"Engine {variant_id} finished loading, model: {current_model}")
                    break
                elif status == 'error':
                    raise RuntimeError(f"Engine {variant_id} model loading failed")
            else:
                raise RuntimeError(f"Engine {variant_id} model loading timeout (5min)")

        # Same engine, same model - nothing to do, but record activity for auto-stop timer
        if current_model == model_name:
            logger.debug(f"Engine {variant_id} already has {model_name} loaded")
            self.record_activity(variant_id)
            return

        # No model loaded yet (e.g., from discovery mode) - just load it
        if not current_model:
            logger.debug(f"Engine {variant_id} has no model loaded, loading {model_name}...")
            await self._load_model(variant_id, model_name)
            self.record_activity(variant_id)
            return

        # Same engine, different model - check if hotswap supported
        # Get metadata from DB (Single Source of Truth)
        metadata = self.get_engine_metadata(variant_id)
        if not metadata:
            raise ValueError(f"Unknown engine: {variant_id}")
        capabilities = metadata.get('capabilities') or {}
        supports_hotswap = capabilities.get('supports_model_hotswap', False)

        if supports_hotswap:
            logger.debug(f"Hotswapping model on {variant_id}: {current_model} → {model_name}")
            await self._load_model(variant_id, model_name)
            self.record_activity(variant_id)
        else:
            # No hotswap - restart engine
            logger.debug(f"Engine {variant_id} doesn't support hotswap, restarting...")
            await self.stop_engine_server(variant_id)
            await self.start_engine_server(variant_id, model_name)

    async def health_check(self, variant_id: str) -> Dict[str, Any]:
        """
        Call engine's /health endpoint

        Args:
            variant_id: Variant to check (e.g., 'xtts:local')

        Returns:
            Health status dictionary:
            - status: 'ready', 'loading', 'error'
            - engineModelLoaded: Whether model is loaded
            - currentEngineModel: Currently loaded model name

        Raises:
            RuntimeError: If engine not running
            httpx.RequestError: If health check fails
        """
        # Use get_engine_base_url to support discovered containers
        base_url = self.get_engine_base_url(variant_id)
        url = f"{base_url}/health"

        from config import ENGINE_HEALTH_CHECK_TIMEOUT
        try:
            response = await self.http_client.get(url, timeout=float(ENGINE_HEALTH_CHECK_TIMEOUT))
            response.raise_for_status()
        except httpx.RequestError as e:
            raise RuntimeError(f"HTTP request to {variant_id} failed: {e}")
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"Engine {variant_id} returned error {e.response.status_code}: {e.response.text[:200]}")

        try:
            return response.json()
        except ValueError as e:
            raise RuntimeError(f"Invalid JSON response from {variant_id}: {e}")

    def get_engine_base_url(self, variant_id: str) -> str:
        """
        Get base URL for engine HTTP communication.

        Checks multiple sources in order:
        1. Manager's engine_endpoints (set during start_engine_server)
        2. Runner's endpoints (for discovered containers)
        3. Legacy port-based URL

        Args:
            variant_id: Variant identifier (e.g., 'xtts:local')

        Returns:
            Base URL for HTTP requests (e.g., "http://127.0.0.1:8766")

        Raises:
            RuntimeError: If engine is not running
        """
        # Check 1: Manager's engine_endpoints (keyed by variant_id)
        endpoint = self.engine_endpoints.get(variant_id)
        if endpoint:
            return endpoint.base_url

        # Check 2: Query runner's endpoints (for discovered containers)
        for runner in self.runner_registry.runners.values():
            runner_endpoint = runner.get_endpoint(variant_id)
            if runner_endpoint:
                return runner_endpoint.base_url

        # Check 3: Fallback to legacy port-based URL (keyed by variant_id)
        port = self.engine_ports.get(variant_id)
        if port:
            return f"http://127.0.0.1:{port}"

        raise RuntimeError(f"Engine {variant_id} not running")

    async def shutdown_all_engines(self):
        """
        Stop all running engine servers (called on backend shutdown)

        Stops all engines (subprocess and Docker) via stop_engine_server().
        """
        # Use engine_endpoints which contains ALL running engines (subprocess + Docker)
        variant_ids = list(self.engine_endpoints.keys())

        for variant_id in variant_ids:
            logger.debug(f"Shutting down {variant_id}...")
            await self.stop_engine_server(variant_id)

        if variant_ids:
            logger.info(f"All {self.engine_type} engines shut down ({len(variant_ids)} engines)")

    def is_engine_running(self, variant_id: str) -> bool:
        """
        Check if an engine server is running (subprocess or Docker container)

        Args:
            variant_id: Variant to check (e.g., 'xtts:local', 'xtts:docker:local')

        Returns:
            True if running, False otherwise
        """
        # Check via runner - works for both subprocess (LocalRunner) and Docker (DockerRunner)
        for runner in self.runner_registry.runners.values():
            if runner.is_running(variant_id):
                return True

        # Engine not running via any runner - cleanup stale tracking entries if present
        if variant_id in self.engine_endpoints:
            logger.debug(f"Engine {variant_id} no longer running, cleaning up stale endpoint")
            del self.engine_endpoints[variant_id]

        if variant_id in self.engine_ports:
            port = self.engine_ports[variant_id]
            del self.engine_ports[variant_id]
            # Release port from global registry
            global _global_used_ports
            _global_used_ports.discard(port)
            logger.debug(f"Port {port} released from {variant_id} (stale cleanup)")

        if self.active_engine == variant_id:
            self.active_engine = None

        return False

    def is_engine_starting(self, variant_id: str) -> bool:
        """
        Check if an engine is currently being started

        Args:
            variant_id: Engine variant to check (e.g., 'xtts:local')

        Returns:
            True if engine is in the process of starting, False otherwise
        """
        return variant_id in self._starting_engines

    def is_engine_stopping(self, variant_id: str) -> bool:
        """
        Check if an engine is currently being stopped

        Args:
            variant_id: Engine variant to check (e.g., 'xtts:local')

        Returns:
            True if engine is in the process of stopping, False otherwise
        """
        return variant_id in self._stopping_engines

    def get_running_engines(self) -> List[str]:
        """
        Get list of currently running engine variant IDs

        Returns:
            List of variant IDs (e.g., ['xtts:local', 'chatterbox:docker:local'])
        """
        # Collect from both manager endpoints and runner endpoints (for discovered containers)
        running = set(self.engine_endpoints.keys())

        # Also check runners for discovered containers not yet in engine_endpoints
        for runner in self.runner_registry.runners.values():
            for variant_id in list(runner.endpoints.keys()):
                if runner.is_running(variant_id):
                    running.add(variant_id)

        return list(running)

    # ========== Variant ID Methods ==========

    def get_engine_by_variant_id(self, variant_id: str) -> Optional[Dict[str, Any]]:
        """
        Get engine metadata by variant_id.

        Returns metadata from database (Single Source of Truth).

        Args:
            variant_id: Full variant identifier

        Returns:
            Engine metadata dict or None
        """
        engine_name, runner_id = parse_variant_id(variant_id)

        # Get metadata from DB (Single Source of Truth)
        metadata = self.get_engine_metadata(variant_id)
        if metadata:
            # Add variant-specific fields
            result = metadata.copy()
            result['variant_id'] = variant_id
            result['base_engine_name'] = engine_name
            result['runner_id'] = runner_id
            result['source'] = 'docker' if 'docker' in runner_id else 'local'
            return result

        return None

    def get_all_variants(self) -> Dict[str, Dict[str, Any]]:
        """
        Get all engine variants with variant metadata.

        Returns dictionary of variant_id -> metadata from database.

        Returns:
            Dictionary of variant_id -> variant metadata
        """
        variants = {}

        try:
            from db.database import get_db_connection_simple
            from db.engine_repository import EngineRepository

            conn = get_db_connection_simple()
            engine_repo = EngineRepository(conn)

            # Get all engines of this type from DB
            all_engines = engine_repo.get_by_type(self.engine_type)
            conn.close()

            for engine_data in all_engines:
                variant_id = engine_data.get('variant_id')
                if not variant_id:
                    continue

                engine_name, runner_id = parse_variant_id(variant_id)

                variant_metadata = {
                    'name': engine_data.get('base_engine_name'),
                    'display_name': engine_data.get('display_name'),
                    'variant_id': variant_id,
                    'base_engine_name': engine_name,
                    'runner_id': runner_id,
                    'runner_type': 'docker' if 'docker' in runner_id else 'subprocess',
                    'source': 'docker' if 'docker' in runner_id else 'local',
                    'is_installed': engine_data.get('is_installed', False),
                    'enabled': engine_data.get('enabled', False),
                }

                variants[variant_id] = variant_metadata

        except Exception as e:
            logger.error(f"Failed to get all variants: {e}")

        return variants

    async def start_by_variant(self, variant_id: str, config: Optional[Dict[str, Any]] = None) -> None:
        """
        Start an engine by variant_id.

        Convenience wrapper around ensure_engine_ready that passes variant_id directly.
        The runner is determined from the variant_id (e.g., 'xtts:docker:local' uses docker:local runner).

        Args:
            variant_id: Variant identifier (e.g., 'xtts:local', 'xtts:docker:local')
            config: Optional configuration dictionary with 'model_name' key
        """
        # Extract model_name from config if provided
        model_name = config.get("model_name") if config else None

        # Pass variant_id directly - ensure_engine_ready handles runner selection
        await self.ensure_engine_ready(variant_id, model_name)

    async def stop_by_variant(self, variant_id: str) -> None:
        """
        Stop an engine by variant_id.

        Args:
            variant_id: Variant identifier (e.g., 'xtts:local', 'xtts:docker:local')
        """
        # Pass variant_id directly - stop_engine_server handles runner selection
        await self.stop_engine_server(variant_id)

    async def cleanup(self):
        """
        Cleanup resources (HTTP client, processes)

        Called on backend shutdown to ensure clean exit.
        Stops all engines and closes HTTP client.
        """
        await self.shutdown_all_engines()
        await self.http_client.aclose()

    # ========== Auto-Stop / Activity Tracking ==========

    def record_activity(self, variant_id: str):
        """
        Record activity timestamp for engine

        Called whenever engine is used (generation, segmentation, analysis, etc.)
        to reset the inactivity timer.

        Args:
            variant_id: Engine variant identifier (e.g., 'xtts:local')
        """
        self._last_activity[variant_id] = datetime.now(timezone.utc)
        logger.debug(f"Activity recorded for {variant_id} at {datetime.now(timezone.utc).isoformat()}")

    def set_exempt_from_auto_stop(self, variant_id: str):
        """
        Mark engine as exempt from auto-stop

        Exempt engines (e.g., default TTS engine) stay running indefinitely.

        Args:
            variant_id: Engine variant identifier (e.g., 'xtts:local')
        """
        self._exempt_from_auto_stop.add(variant_id)
        logger.info(f"Engine {variant_id} marked as exempt from auto-stop (will stay warm)")

    def get_seconds_until_auto_stop(self, variant_id: str) -> Optional[int]:
        """
        Get seconds remaining until engine auto-stops due to inactivity

        Args:
            variant_id: Engine variant identifier (e.g., 'xtts:local')

        Returns:
            Seconds until auto-stop, or None if:
            - Engine is not running
            - Engine is exempt from auto-stop
            - No activity recorded yet
        """
        # Not running or exempt (use engine_endpoints for all engine types)
        if variant_id not in self.engine_endpoints or variant_id in self._exempt_from_auto_stop:
            return None

        # No activity recorded
        if variant_id not in self._last_activity:
            return None

        # Calculate remaining time
        last_active = self._last_activity[variant_id]
        elapsed = (datetime.now(timezone.utc) - last_active).total_seconds()
        remaining = self._inactivity_timeout - elapsed

        return max(0, int(remaining))

    async def check_idle_engines(self):
        """
        Stop engines that have been idle for too long

        Called periodically by background task (every 60s).
        Stops engines idle for > inactivity_timeout (except exempt engines).

        Works for both subprocess and Docker engines by using the runner-based
        stop mechanism via stop_engine_server().
        """
        now = datetime.now(timezone.utc)

        # Iterate over engine_endpoints (contains ALL running engines: subprocess + Docker)
        for variant_id in list(self.engine_endpoints.keys()):
            # Skip exempt engines (e.g., keepRunning=true)
            if variant_id in self._exempt_from_auto_stop:
                continue

            # Skip if no activity recorded (just started)
            if variant_id not in self._last_activity:
                continue

            # Check idle time
            last_active = self._last_activity[variant_id]
            idle_seconds = (now - last_active).total_seconds()

            if idle_seconds > self._inactivity_timeout:
                logger.info(
                    f"Stopping {variant_id} due to inactivity "
                    f"({int(idle_seconds)}s > {self._inactivity_timeout}s)"
                )

                # Parse variant_id to get base engine name for SSE events
                base_engine_name, _ = parse_variant_id(variant_id)

                # Mark engine as stopping
                self._stopping_engines.add(variant_id)
                logger.debug(f"Engine {variant_id} marked as 'stopping' (inactivity)")

                # Emit SSE event for immediate UI feedback
                try:
                    asyncio.create_task(emit_engine_stopping(self.engine_type, base_engine_name, "auto_stop", variant_id=variant_id))
                except Exception as e:
                    logger.warning(f"Failed to emit engine.stopping event: {e}")

                try:
                    # Try graceful shutdown via HTTP /shutdown endpoint
                    try:
                        base_url = self.get_engine_base_url(variant_id)
                        if base_url:
                            from config import ENGINE_HEALTH_CHECK_TIMEOUT
                            url = f"{base_url}/shutdown"
                            await self.http_client.post(url, timeout=float(ENGINE_HEALTH_CHECK_TIMEOUT))
                            logger.debug(f"Sent shutdown request to {variant_id}")
                    except Exception as e:
                        logger.debug(f"Graceful shutdown request failed: {e}")

                    # Stop via runner (handles both subprocess and Docker)
                    runner = self.runner_registry.get_runner_by_variant(variant_id)
                    if runner.is_running(variant_id):
                        await runner.stop(variant_id)
                        logger.info(f"{variant_id} stopped via runner (inactivity)")

                    # Cleanup endpoint
                    self.engine_endpoints.pop(variant_id, None)

                    # Cleanup port
                    if variant_id in self.engine_ports:
                        port = self.engine_ports[variant_id]
                        del self.engine_ports[variant_id]
                        # Release port from global registry
                        global _global_used_ports
                        _global_used_ports.discard(port)
                        logger.debug(f"Port {port} released from {variant_id} (inactivity)")

                    if self.active_engine == variant_id:
                        self.active_engine = None

                    # Remove from activity tracking
                    if variant_id in self._last_activity:
                        del self._last_activity[variant_id]

                    # Emit engine stopped event with "inactivity" reason
                    await safe_broadcast(
                        emit_engine_stopped,
                        self.engine_type,
                        base_engine_name,
                        reason="inactivity",
                        variant_id=variant_id,
                        event_description="engine.stopped"
                    )

                except Exception as e:
                    logger.error(f"Failed to auto-stop {variant_id}: {e}")
                finally:
                    # Always remove from stopping state
                    self._stopping_engines.discard(variant_id)
                    logger.debug(f"Engine {variant_id} removed from 'stopping' state (inactivity)")

    def __repr__(self) -> str:
        """String representation for debugging"""
        running = ', '.join(self.engine_endpoints.keys()) or 'none'
        installed_count = len(self.list_installed_engines())
        return (
            f"<{self.__class__.__name__} "
            f"type={self.engine_type} "
            f"installed={installed_count} "
            f"running={len(self.engine_endpoints)} ({running}) "
            f"active={self.active_engine}>"
        )
