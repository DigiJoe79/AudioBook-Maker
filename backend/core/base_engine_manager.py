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
import subprocess
import socket
import asyncio
import os
import httpx
from loguru import logger

from services.event_broadcaster import emit_engine_started, emit_engine_stopped, emit_engine_starting, emit_engine_stopping, emit_engine_error


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
        _engine_metadata: Dictionary of discovered engine metadata
        engine_processes: Running engine server processes
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
        self._engine_metadata: Dict[str, Any] = {}

        # Process management
        self.engine_processes: Dict[str, subprocess.Popen] = {}
        self.engine_ports: Dict[str, int] = {}
        self.active_engine: Optional[str] = None

        # Lifecycle status tracking
        self._starting_engines: Set[str] = set()  # Engines that are currently starting
        self._stopping_engines: Set[str] = set()  # Engines that are currently stopping

        # Auto-stop configuration
        self._last_activity: Dict[str, datetime] = {}  # Track last activity per engine
        self._inactivity_timeout: int = self._load_inactivity_timeout()  # Load from settings
        self._exempt_from_auto_stop: Set[str] = set()  # Engines that should stay warm (from keepRunning settings)

        # Discovery mode configuration
        from config import ENGINE_DISCOVERY_TIMEOUT
        self._discovery_timeout: int = ENGINE_DISCOVERY_TIMEOUT
        self._discovery_mode_engines: Set[str] = set()  # Engines started for discovery only

        # Model discovery cache (populated at startup or on enable)
        self._discovered_models: Dict[str, List[Dict[str, Any]]] = {}  # engine_name → List[ModelInfo dict]
        self._discovery_errors: Dict[str, str] = {}  # engine_name → error message

        # HTTP client (timeout for long operations)
        from config import ENGINE_HTTP_TIMEOUT
        self.http_client = httpx.AsyncClient(timeout=float(ENGINE_HTTP_TIMEOUT))

        # Discover engines on init
        self._discover_engines()

        # Load keep running settings after discovery
        self.sync_keep_running_from_settings()

        logger.success(
            f"{self.__class__.__name__} initialized with "
            f"{len(self._engine_metadata)} available engines: "
            f"{', '.join(self._engine_metadata.keys())}"
        )

    @abstractmethod
    def _discover_engines(self) -> None:
        """
        Discover engines from engines_base_path

        Must be implemented by subclass to use appropriate discovery class.
        Should populate self._engine_metadata dictionary.

        Example (TTS):
            from core.tts_engine_discovery import TTSEngineDiscovery
            discovery = TTSEngineDiscovery(self.engines_base_path)
            self._engine_metadata = discovery.discover_all()
        """
        pass

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

            # Load keepRunning for all discovered engines
            for engine_name in self._engine_metadata.keys():
                keep_running = settings_service.get_engine_keep_running(engine_name, self.engine_type)
                if keep_running:
                    self._exempt_from_auto_stop.add(engine_name)

            # Log changes
            added = self._exempt_from_auto_stop - old_exempt
            removed = old_exempt - self._exempt_from_auto_stop

            if added:
                logger.info(f"Engines marked as keep running: {', '.join(added)}")
            if removed:
                logger.info(f"Engines no longer keep running: {', '.join(removed)}")

        except Exception as e:
            logger.warning(f"Could not sync keep running settings: {e}")

    def sync_keep_running_state(self, engine_name: str, keep_running: bool):
        """
        Synchronize keep_running state for a single engine (called from settings service)

        This method is called when a user toggles the keepRunning flag in the UI.
        It immediately updates the manager's internal _exempt_from_auto_stop set
        without requiring a full settings reload.

        Args:
            engine_name: Engine identifier
            keep_running: New keep_running state
        """
        old_state = engine_name in self._exempt_from_auto_stop

        if keep_running:
            self._exempt_from_auto_stop.add(engine_name)
        else:
            self._exempt_from_auto_stop.discard(engine_name)

        # Only log if state actually changed
        if old_state != keep_running:
            action = "marked as keep running (will not auto-stop)" if keep_running else "no longer keep running (subject to auto-stop)"
            logger.info(f"Engine {engine_name} {action} (engine_type={self.engine_type})")

    # ========== Common Methods (All Engine Types) ==========

    def list_available_engines(self) -> List[str]:
        """
        Get list of all available engine names (only enabled engines)

        Filters by settings.{engine_type}.engines[engine].enabled flag.
        Engines are enabled by default if no settings exist.

        Returns:
            List of enabled engine identifiers (e.g., ['xtts', 'chatterbox'])
        """
        from services.settings_service import SettingsService
        from db.database import get_db_connection_simple

        # Get settings to check enabled status
        try:
            conn = get_db_connection_simple()
            settings_service = SettingsService(conn)

            # Check each discovered engine's enabled status individually
            # This correctly handles the case where no settings exist (defaults to enabled)
            return [
                e for e in self._engine_metadata.keys()
                if settings_service.is_engine_enabled(e, self.engine_type)
            ]
        except Exception as e:
            logger.warning(f"Could not filter by enabled engines: {e}, returning all discovered engines")
            return list(self._engine_metadata.keys())

    def list_all_engines(self) -> List[str]:
        """
        Get list of ALL engine names (including disabled)

        Returns:
            List of all discovered engine identifiers
        """
        return list(self._engine_metadata.keys())

    def is_engine_available(self, engine_name: str) -> bool:
        """
        Check if an engine is available (discovered AND enabled)

        Args:
            engine_name: Engine identifier to check

        Returns:
            True if engine is discovered and enabled, False otherwise
        """
        # First check if engine is discovered
        if engine_name not in self._engine_metadata:
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
            if ename not in self._engine_metadata:
                logger.warning(f"Unknown engine: {ename}")
                continue

            metadata = self._engine_metadata[ename]

            # Check if engine is enabled
            is_enabled = True  # Default
            if settings_service:
                try:
                    is_enabled = settings_service.is_engine_enabled(ename, self.engine_type)
                except Exception as e:
                    logger.warning(f"Could not check enabled status for {ename}: {e}")

            info_list.append({
                'name': metadata.get('name', ename),
                'display_name': metadata.get('display_name', ename),
                'capabilities': metadata.get('capabilities', {}),
                'constraints': metadata.get('constraints', {}),
                'supported_languages': metadata.get('supported_languages', []),
                'is_enabled': is_enabled,
                'is_running': ename in self.engine_processes,
                'port': self.engine_ports.get(ename)
            })

        return info_list

    def get_available_models(self, engine_name: str) -> List[Dict[str, Any]]:
        """
        Get list of available models for a specific engine

        Args:
            engine_name: Engine identifier (e.g., 'xtts', 'whisper', 'spacy')

        Returns:
            List of model dictionaries with metadata:
            - engine_model_name: Model identifier
            - display_name: Human-readable name
            - path: Path to model directory (if local)
            - exists: Whether model files exist (if local)

        Raises:
            ValueError: If engine_name is unknown
        """
        if engine_name not in self._engine_metadata:
            available = ', '.join(self._engine_metadata.keys())
            raise ValueError(
                f"Unknown {self.engine_type} engine: '{engine_name}'. "
                f"Available engines: {available}"
            )

        metadata = self._engine_metadata[engine_name]
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

    async def start_engine_for_discovery(self, engine_name: str) -> int:
        """
        Start engine server WITHOUT loading a model (fast, for /models endpoint)

        Used for model discovery at startup or when enabling an engine.
        Engine stays running for 30s auto-stop timeout in case it's needed for work.

        Args:
            engine_name: Engine identifier (e.g., 'xtts', 'spacy')

        Returns:
            Port number the engine is listening on

        Raises:
            ValueError: If engine is unknown
            RuntimeError: If engine start fails or health check times out
        """
        if engine_name not in self._engine_metadata:
            raise ValueError(f"Unknown engine: {engine_name}")

        # If engine is currently starting by another task, wait for it
        if engine_name in self._starting_engines:
            logger.debug(f"Engine {engine_name} already starting, waiting...")
            for _ in range(35):  # Wait up to 35s for start to complete
                await asyncio.sleep(1)
                if engine_name not in self._starting_engines:
                    break
            # Check if it's now running
            if engine_name in self.engine_processes:
                return self.engine_ports[engine_name]
            # If still not running, fall through to start it ourselves

        # If engine is already running, just return its port
        if engine_name in self.engine_processes:
            return self.engine_ports[engine_name]

        # Mark engine as starting
        self._starting_engines.add(engine_name)
        logger.debug(f"Engine {engine_name} marked as 'starting' (discovery mode)")

        try:
            metadata = self._engine_metadata[engine_name]

            # Find free port
            port = self.find_free_port()
            self.engine_ports[engine_name] = port

            # Build command
            venv_path = metadata.get('venv_path')
            server_script = metadata.get('server_script')

            if not venv_path or not server_script:
                raise RuntimeError(f"Engine {engine_name} missing venv_path or server_script")

            # Python executable in VENV
            if os.name == 'nt':  # Windows
                python_exe = venv_path / 'Scripts' / 'python.exe'
            else:  # Linux/Mac
                python_exe = venv_path / 'bin' / 'python'

            if not python_exe.exists():
                raise RuntimeError(f"Python executable not found: {python_exe}")

            cmd = [str(python_exe), str(server_script), '--port', str(port)]

            # Log with relative paths
            try:
                backend_dir = Path(__file__).parent.parent
                script_rel = server_script.relative_to(backend_dir)
                logger.info(f"Starting {engine_name} for discovery: {script_rel} --port {port}")
            except ValueError:
                logger.info(f"Starting {engine_name} for discovery: {' '.join(cmd)}")

            # Start process
            process = subprocess.Popen(
                cmd,
                stdout=None,
                stderr=None,
                cwd=server_script.parent
            )

            self.engine_processes[engine_name] = process

            # Wait for health check (max 30s)
            logger.debug(f"Waiting for {engine_name} server (discovery mode)...")
            for attempt in range(30):
                await asyncio.sleep(1)

                try:
                    health = await self.health_check(engine_name)
                    if health.get('status') in ['ready', 'loading']:
                        logger.info(f"{engine_name} server ready for discovery on port {port}")

                        # NO model loading - that's the key difference from start_engine_server()

                        # Mark as discovery mode engine (shorter auto-stop)
                        self._discovery_mode_engines.add(engine_name)

                        # Record activity for auto-stop
                        self.record_activity(engine_name)

                        # Remove from starting state
                        self._starting_engines.discard(engine_name)
                        logger.debug(f"Engine {engine_name} removed from 'starting' state (discovery)")

                        return port
                except asyncio.TimeoutError:
                    logger.debug(f"Health check timeout for {engine_name}")
                except Exception as e:
                    logger.debug(f"Health check failed for {engine_name}: {e}")

            # Timeout - cleanup
            self._starting_engines.discard(engine_name)
            await self.stop_engine_server(engine_name)
            raise RuntimeError(f"{engine_name} server failed to start within 30s")

        except Exception:
            self._starting_engines.discard(engine_name)
            raise

    async def fetch_models_from_engine(self, engine_name: str) -> List[Dict[str, Any]]:
        """
        Fetch available models from a running engine via /models endpoint

        Args:
            engine_name: Engine identifier

        Returns:
            List of ModelInfo dictionaries from the engine

        Raises:
            RuntimeError: If engine not running or request fails
        """
        port = self.engine_ports.get(engine_name)
        if not port:
            raise RuntimeError(f"Engine {engine_name} not running")

        url = f"http://127.0.0.1:{port}/models"
        try:
            response = await self.http_client.get(url)
            response.raise_for_status()
        except httpx.RequestError as e:
            raise RuntimeError(f"HTTP request to {engine_name} failed: {e}")
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"Engine {engine_name} returned error {e.response.status_code}: {e.response.text[:200]}")

        try:
            data = response.json()
        except ValueError as e:
            raise RuntimeError(f"Invalid JSON response from {engine_name}: {e}")

        return data.get('models', [])

    async def discover_engine_models(self, engine_name: str) -> List[Dict[str, Any]]:
        """
        Discover models from an engine by starting it in discovery mode

        Starts the engine (without loading a model), fetches model info via /models,
        and marks engine for 30s auto-stop (unless work mode takes over).

        This method is robust: it catches all errors and returns empty list on failure.

        Args:
            engine_name: Engine identifier

        Returns:
            List of ModelInfo dictionaries, or empty list on failure
        """
        try:
            logger.debug(f"Discovering models for {engine_name}...")

            # Start engine in discovery mode (no model loaded)
            await self.start_engine_for_discovery(engine_name)

            # Fetch models via /models endpoint
            models = await self.fetch_models_from_engine(engine_name)

            # Cache the results
            self._discovered_models[engine_name] = models
            self._discovery_errors.pop(engine_name, None)  # Clear any previous error

            logger.info(f"Discovered {len(models)} models for {engine_name}")
            return models

        except Exception as e:
            logger.warning(f"Discovery failed for {engine_name}: {e}")
            self._discovery_errors[engine_name] = str(e)
            return []

    def get_discovered_models(self, engine_name: str) -> List[Dict[str, Any]]:
        """
        Get cached model info from previous discovery

        Args:
            engine_name: Engine identifier

        Returns:
            List of ModelInfo dictionaries, or empty list if not discovered
        """
        return self._discovered_models.get(engine_name, [])

    def get_supported_languages(self, engine_name: str) -> List[str]:
        """
        Get aggregated languages from all discovered models of an engine

        Args:
            engine_name: Engine identifier

        Returns:
            List of unique ISO language codes supported by this engine
        """
        models = self.get_discovered_models(engine_name)
        languages = set()
        for model in models:
            model_langs = model.get('languages', [])
            languages.update(model_langs)
        return sorted(languages)

    def discovery_failed(self, engine_name: str) -> bool:
        """
        Check if model discovery failed for this engine

        Args:
            engine_name: Engine identifier

        Returns:
            True if discovery was attempted and failed
        """
        return engine_name in self._discovery_errors

    def get_discovery_error(self, engine_name: str) -> Optional[str]:
        """
        Get the error message from a failed discovery attempt

        Args:
            engine_name: Engine identifier

        Returns:
            Error message string, or None if no error
        """
        return self._discovery_errors.get(engine_name)

    async def start_engine_server(self, engine_name: str, model_name: str) -> int:
        """
        Start engine server process and wait for health check

        Flow:
        1. Check if engine is enabled
        2. Mark as 'starting'
        3. Find free port
        4. Start engine process with VENV Python
        5. Wait for health check (max 30s)
        6. Load model
        7. Mark as active, remove from 'starting'

        Args:
            engine_name: Engine identifier (e.g., 'xtts')
            model_name: Model to load (e.g., 'v2.0.3')

        Returns:
            Port number the engine is listening on

        Raises:
            ValueError: If engine is unknown or disabled
            RuntimeError: If engine start fails or health check times out
        """
        if engine_name not in self._engine_metadata:
            raise ValueError(f"Unknown engine: {engine_name}")

        # Check if engine is enabled
        from services.settings_service import SettingsService
        from db.database import get_db_connection_simple

        try:
            conn = get_db_connection_simple()
            settings_service = SettingsService(conn)
            if not settings_service.is_engine_enabled(engine_name, self.engine_type):
                raise ValueError(f"Engine {engine_name} is disabled. Enable it in settings first.")
        except ValueError:
            raise  # Re-raise disabled error
        except Exception as e:
            logger.warning(f"Could not check enabled status for {engine_name}: {e}, proceeding with start")

        # Mark engine as starting
        self._starting_engines.add(engine_name)
        logger.debug(f"Engine {engine_name} marked as 'starting'")

        # Emit SSE event for immediate UI feedback
        try:
            asyncio.create_task(emit_engine_starting(self.engine_type, engine_name))
        except Exception as e:
            logger.warning(f"Failed to emit engine.starting event: {e}")

        try:
            metadata = self._engine_metadata[engine_name]

            # Find free port
            port = self.find_free_port()
            self.engine_ports[engine_name] = port

            # Build command
            venv_path = metadata.get('venv_path')
            server_script = metadata.get('server_script')

            if not venv_path or not server_script:
                raise RuntimeError(f"Engine {engine_name} missing venv_path or server_script")

            # Python executable in VENV
            if os.name == 'nt':  # Windows
                python_exe = venv_path / 'Scripts' / 'python.exe'
            else:  # Linux/Mac
                python_exe = venv_path / 'bin' / 'python'

            if not python_exe.exists():
                raise RuntimeError(f"Python executable not found: {python_exe}")

            cmd = [str(python_exe), str(server_script), '--port', str(port)]

            # Log with relative paths for readability
            try:
                backend_dir = Path(__file__).parent.parent
                script_rel = server_script.relative_to(backend_dir)
                logger.info(f"Starting {engine_name} server: {script_rel} --port {port}")
            except ValueError:
                # Fallback if paths are not relative to backend
                logger.info(f"Starting {engine_name} server: {' '.join(cmd)}")

            # Start process (inherit stdout/stderr to see engine logs in backend console)
            process = subprocess.Popen(
                cmd,
                stdout=None,  # Inherit from parent (backend logs)
                stderr=None,  # Inherit from parent (backend logs)
                cwd=server_script.parent
            )

            self.engine_processes[engine_name] = process

            # Wait for health check (max 30s)
            logger.debug(f"Waiting for {engine_name} server to be ready...")
            for attempt in range(30):
                await asyncio.sleep(1)

                try:
                    health = await self.health_check(engine_name)
                    if health.get('status') in ['ready', 'loading']:
                        logger.info(f"{engine_name} server ready on port {port}")

                        # Load model
                        await self._load_model(engine_name, model_name)

                        # Record activity (engine just started)
                        self.record_activity(engine_name)

                        self.active_engine = engine_name

                        # Remove from starting state
                        self._starting_engines.discard(engine_name)
                        logger.debug(f"Engine {engine_name} removed from 'starting' state")

                        # Get package version from health check for SSE event
                        package_version = health.get('packageVersion')

                        # Emit engine started event
                        try:
                            await emit_engine_started(self.engine_type, engine_name, port, version=package_version)
                        except Exception as e:
                            logger.warning(f"Failed to broadcast engine start event: {e}")

                        return port
                except asyncio.TimeoutError:
                    logger.debug(f"Health check timeout for {engine_name}")
                except Exception as e:
                    logger.debug(f"Health check failed for {engine_name}: {e}")

            # Timeout - cleanup starting state before stopping
            self._starting_engines.discard(engine_name)
            logger.debug(f"Engine {engine_name} removed from 'starting' state (timeout)")
            await self.stop_engine_server(engine_name)
            error_msg = f"{engine_name} server failed to start within 30s"
            # Emit engine error event
            try:
                asyncio.create_task(emit_engine_error(self.engine_type, engine_name, error_msg, "Startup timeout"))
            except Exception as e:
                logger.warning(f"Failed to broadcast engine error event: {e}")
            raise RuntimeError(error_msg)

        except Exception as e:
            # Any error during startup - cleanup starting state
            self._starting_engines.discard(engine_name)
            logger.debug(f"Engine {engine_name} removed from 'starting' state (error)")
            # Emit engine error event
            try:
                asyncio.create_task(emit_engine_error(self.engine_type, engine_name, str(e), "Startup error"))
            except Exception as emit_err:
                logger.warning(f"Failed to broadcast engine error event: {emit_err}")
            raise

    async def _load_model(self, engine_name: str, model_name: str):
        """
        Call engine's /load endpoint to load model

        Args:
            engine_name: Engine identifier
            model_name: Model to load

        Raises:
            RuntimeError: If engine not running or model loading fails
        """
        port = self.engine_ports.get(engine_name)
        if not port:
            raise RuntimeError(f"Engine {engine_name} not running")

        url = f"http://127.0.0.1:{port}/load"

        logger.debug(f"Loading model {model_name} on {engine_name}...")

        # Note: CamelCaseModel accepts both snake_case and camelCase (populate_by_name=True)
        # Using camelCase here for consistency with JSON API convention
        try:
            response = await self.http_client.post(url, json={"engineModelName": model_name})
            response.raise_for_status()
        except httpx.RequestError as e:
            raise RuntimeError(f"HTTP request to {engine_name} failed: {e}")
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"Engine {engine_name} returned error {e.response.status_code}: {e.response.text[:200]}")

        try:
            result = response.json()
        except ValueError as e:
            raise RuntimeError(f"Invalid JSON response from {engine_name}: {e}")

        if result.get('status') != 'loaded':
            raise RuntimeError(f"Model loading failed: {result.get('error')}")

        # Transition from discovery mode to work mode (if was in discovery)
        if engine_name in self._discovery_mode_engines:
            self._discovery_mode_engines.discard(engine_name)
            logger.debug(f"Engine {engine_name} transitioned from discovery to work mode")

        logger.success(f"Model {model_name} loaded successfully on {engine_name}")

    async def stop_engine_server(self, engine_name: str, timeout: int = 30):
        """
        Gracefully stop engine via /shutdown, then kill if timeout

        Flow:
        1. Mark as 'stopping'
        2. Send /shutdown request to engine
        3. Wait for process to exit (max timeout seconds)
        4. Force-kill if timeout exceeded
        5. Cleanup process/port tracking, remove from 'stopping'

        Args:
            engine_name: Engine to stop
            timeout: Seconds to wait before force-kill (default: 30)
        """
        if engine_name not in self.engine_processes:
            logger.warning(f"Engine {engine_name} not running")
            return

        # Mark engine as stopping
        self._stopping_engines.add(engine_name)
        logger.debug(f"Engine {engine_name} marked as 'stopping'")

        # Emit SSE event for immediate UI feedback
        try:
            asyncio.create_task(emit_engine_stopping(self.engine_type, engine_name, "manual"))
        except Exception as e:
            logger.warning(f"Failed to emit engine.stopping event: {e}")

        try:
            # Try graceful shutdown
            try:
                port = self.engine_ports.get(engine_name)
                if port:
                    from config import ENGINE_HEALTH_CHECK_TIMEOUT
                    url = f"http://127.0.0.1:{port}/shutdown"
                    await self.http_client.post(url, timeout=float(ENGINE_HEALTH_CHECK_TIMEOUT))
                    logger.debug(f"Sent shutdown request to {engine_name}")
            except Exception as e:
                # Expected if engine already stopped or shutting down
                logger.debug(f"Graceful shutdown request failed (expected during app shutdown): {e}")

            # Wait for process to exit (run in thread to avoid blocking event loop)
            process = self.engine_processes[engine_name]
            try:
                # Use asyncio.to_thread to run blocking wait() in a thread pool
                await asyncio.wait_for(
                    asyncio.to_thread(process.wait),
                    timeout=timeout
                )
                logger.info(f"{engine_name} server stopped gracefully")
            except asyncio.TimeoutError:
                logger.warning(f"{engine_name} server timeout, force killing...")
                process.kill()
                await asyncio.to_thread(process.wait)
                logger.info(f"{engine_name} server force-killed")

            # Cleanup
            del self.engine_processes[engine_name]
            if engine_name in self.engine_ports:
                port = self.engine_ports[engine_name]
                del self.engine_ports[engine_name]
                # Release port from global registry
                global _global_used_ports
                _global_used_ports.discard(port)
                logger.debug(f"Port {port} released from {engine_name} (global registry: {_global_used_ports})")

            if self.active_engine == engine_name:
                self.active_engine = None

            # Clear discovery mode flag
            self._discovery_mode_engines.discard(engine_name)

            # Emit engine stopped event (manual stop)
            try:
                await emit_engine_stopped(self.engine_type, engine_name, reason="manual")
            except Exception as e:
                logger.warning(f"Failed to broadcast engine stop event: {e}")

        finally:
            # Always remove from stopping state, even on error
            self._stopping_engines.discard(engine_name)
            logger.debug(f"Engine {engine_name} removed from 'stopping' state")

    async def ensure_engine_ready(self, engine_name: str, model_name: str):
        """
        Ensure engine is running and has correct model loaded

        Handles:
        - Starting engine if not running
        - Switching engines if different engine active (stops old engine first)
        - Hotswapping model if same engine but different model (if supported)

        Args:
            engine_name: Engine identifier
            model_name: Model to load
        """
        # Check if a different engine is running
        running_engines = list(self.engine_processes.keys())
        other_engines = [e for e in running_engines if e != engine_name]

        if other_engines:
            logger.info(f"Switching engines: stopping {other_engines} to start {engine_name}")
            for other_engine in other_engines:
                await self.stop_engine_server(other_engine)

        # Engine not running - start it
        if engine_name not in self.engine_processes:
            logger.debug(f"Engine {engine_name} not running, starting...")
            await self.start_engine_server(engine_name, model_name)
            return

        # Check current model
        health = await self.health_check(engine_name)
        current_model = health.get('currentEngineModel')

        # Same engine, same model - nothing to do
        if current_model == model_name:
            logger.debug(f"Engine {engine_name} already has {model_name} loaded")
            return

        # No model loaded yet (e.g., from discovery mode) - just load it
        if not current_model:
            logger.debug(f"Engine {engine_name} has no model loaded, loading {model_name}...")
            await self._load_model(engine_name, model_name)
            return

        # Same engine, different model - check if hotswap supported
        metadata = self._engine_metadata[engine_name]
        supports_hotswap = metadata.get('capabilities', {}).get('supports_model_hotswap', False)

        if supports_hotswap:
            logger.debug(f"Hotswapping model on {engine_name}: {current_model} → {model_name}")
            await self._load_model(engine_name, model_name)
        else:
            # No hotswap - restart engine
            logger.debug(f"Engine {engine_name} doesn't support hotswap, restarting...")
            await self.stop_engine_server(engine_name)
            await self.start_engine_server(engine_name, model_name)

    async def health_check(self, engine_name: str) -> Dict[str, Any]:
        """
        Call engine's /health endpoint

        Args:
            engine_name: Engine to check

        Returns:
            Health status dictionary:
            - status: 'ready', 'loading', 'error'
            - engineModelLoaded: Whether model is loaded
            - currentEngineModel: Currently loaded model name

        Raises:
            RuntimeError: If engine not running
            httpx.RequestError: If health check fails
        """
        port = self.engine_ports.get(engine_name)
        if not port:
            raise RuntimeError(f"Engine {engine_name} not running")

        url = f"http://127.0.0.1:{port}/health"

        from config import ENGINE_HEALTH_CHECK_TIMEOUT
        try:
            response = await self.http_client.get(url, timeout=float(ENGINE_HEALTH_CHECK_TIMEOUT))
            response.raise_for_status()
        except httpx.RequestError as e:
            raise RuntimeError(f"HTTP request to {engine_name} failed: {e}")
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"Engine {engine_name} returned error {e.response.status_code}: {e.response.text[:200]}")

        try:
            return response.json()
        except ValueError as e:
            raise RuntimeError(f"Invalid JSON response from {engine_name}: {e}")

    async def shutdown_all_engines(self):
        """
        Stop all running engine servers (called on backend shutdown)

        Stops all engines in parallel for faster shutdown.
        """
        engine_names = list(self.engine_processes.keys())

        for engine_name in engine_names:
            logger.debug(f"Shutting down {engine_name}...")
            await self.stop_engine_server(engine_name)

        if engine_names:
            logger.info(f"All {self.engine_type} engines shut down ({len(engine_names)} engines)")

    def is_engine_running(self, engine_name: str) -> bool:
        """
        Check if an engine server is running

        Args:
            engine_name: Engine to check

        Returns:
            True if running, False otherwise
        """
        if engine_name not in self.engine_processes:
            return False

        # Check if process is still alive (poll() returns None if running, exit code if dead)
        process = self.engine_processes[engine_name]
        exit_code = process.poll()

        if exit_code is not None:
            # Process has exited - cleanup stale entries
            # Exit code 0 = clean shutdown (e.g., Ctrl+C), otherwise unexpected death
            if exit_code == 0:
                logger.debug(f"Engine {engine_name} exited cleanly, cleaning up")
            else:
                logger.warning(f"Engine {engine_name} process died (exit code: {exit_code}), cleaning up")
            del self.engine_processes[engine_name]

            if engine_name in self.engine_ports:
                port = self.engine_ports[engine_name]
                del self.engine_ports[engine_name]
                # Release port from global registry
                global _global_used_ports
                _global_used_ports.discard(port)

            if self.active_engine == engine_name:
                self.active_engine = None

            # Clear discovery mode flag
            self._discovery_mode_engines.discard(engine_name)

            return False

        return True

    def is_engine_starting(self, engine_name: str) -> bool:
        """
        Check if an engine is currently being started

        Args:
            engine_name: Engine to check

        Returns:
            True if engine is in the process of starting, False otherwise
        """
        return engine_name in self._starting_engines

    def is_engine_stopping(self, engine_name: str) -> bool:
        """
        Check if an engine is currently being stopped

        Args:
            engine_name: Engine to check

        Returns:
            True if engine is in the process of stopping, False otherwise
        """
        return engine_name in self._stopping_engines

    def get_running_engines(self) -> List[str]:
        """
        Get list of currently running engine names

        Returns:
            List of engine names (e.g., ['xtts', 'chatterbox'])
        """
        return list(self.engine_processes.keys())

    async def cleanup(self):
        """
        Cleanup resources (HTTP client, processes)

        Called on backend shutdown to ensure clean exit.
        Stops all engines and closes HTTP client.
        """
        await self.shutdown_all_engines()
        await self.http_client.aclose()

    # ========== Auto-Stop / Activity Tracking ==========

    def record_activity(self, engine_name: str):
        """
        Record activity timestamp for engine

        Called whenever engine is used (generation, segmentation, analysis, etc.)
        to reset the inactivity timer.

        Args:
            engine_name: Engine identifier
        """
        self._last_activity[engine_name] = datetime.now(timezone.utc)
        logger.debug(f"Activity recorded for {engine_name} at {datetime.now(timezone.utc).isoformat()}")

    def set_exempt_from_auto_stop(self, engine_name: str):
        """
        Mark engine as exempt from auto-stop

        Exempt engines (e.g., default TTS engine) stay running indefinitely.

        Args:
            engine_name: Engine identifier
        """
        self._exempt_from_auto_stop.add(engine_name)
        logger.info(f"Engine {engine_name} marked as exempt from auto-stop (will stay warm)")

    def get_seconds_until_auto_stop(self, engine_name: str) -> Optional[int]:
        """
        Get seconds remaining until engine auto-stops due to inactivity

        Args:
            engine_name: Engine identifier

        Returns:
            Seconds until auto-stop, or None if:
            - Engine is not running
            - Engine is exempt from auto-stop
            - Engine is in discovery mode (will be stopped immediately)
            - No activity recorded yet
        """
        # Not running or exempt
        if engine_name not in self.engine_processes or engine_name in self._exempt_from_auto_stop:
            return None

        # Discovery mode engines don't show countdown - they're stopped immediately
        # after discovery completes (Phase 2 in startup), not via auto-stop timer
        if engine_name in self._discovery_mode_engines:
            return None

        # No activity recorded
        if engine_name not in self._last_activity:
            return None

        # Calculate remaining time
        last_active = self._last_activity[engine_name]
        elapsed = (datetime.now(timezone.utc) - last_active).total_seconds()
        remaining = self._inactivity_timeout - elapsed

        return max(0, int(remaining))

    async def check_idle_engines(self):
        """
        Stop engines that have been idle for too long

        Called periodically by background task (every 60s).
        Stops engines idle for > 5 minutes (except exempt engines).
        """
        now = datetime.now(timezone.utc)

        for engine_name in list(self.engine_processes.keys()):
            # Skip exempt engines (e.g., default TTS)
            if engine_name in self._exempt_from_auto_stop:
                continue

            # Skip if no activity recorded (just started)
            if engine_name not in self._last_activity:
                continue

            # Check idle time - use shorter timeout for discovery mode engines
            last_active = self._last_activity[engine_name]
            idle_seconds = (now - last_active).total_seconds()

            # Discovery mode engines have shorter auto-stop (30s vs 5min)
            timeout = self._discovery_timeout if engine_name in self._discovery_mode_engines else self._inactivity_timeout

            if idle_seconds > timeout:
                mode = "discovery" if engine_name in self._discovery_mode_engines else "work"
                logger.info(
                    f"Stopping {engine_name} due to inactivity "
                    f"({int(idle_seconds)}s > {timeout}s, mode={mode})"
                )

                # Mark engine as stopping
                self._stopping_engines.add(engine_name)
                logger.debug(f"Engine {engine_name} marked as 'stopping' (inactivity)")

                # Emit SSE event for immediate UI feedback
                try:
                    asyncio.create_task(emit_engine_stopping(self.engine_type, engine_name, "auto_stop"))
                except Exception as e:
                    logger.warning(f"Failed to emit engine.stopping event: {e}")

                try:
                    # Stop engine (this will emit "manual" reason, but we override below)
                    # Note: We need to stop the engine first to clean up the process
                    port = self.engine_ports.get(engine_name)

                    # Try graceful shutdown
                    try:
                        if port:
                            from config import ENGINE_HEALTH_CHECK_TIMEOUT
                            url = f"http://127.0.0.1:{port}/shutdown"
                            await self.http_client.post(url, timeout=float(ENGINE_HEALTH_CHECK_TIMEOUT))
                            logger.debug(f"Sent shutdown request to {engine_name}")
                    except Exception as e:
                        logger.warning(f"Graceful shutdown failed: {e}")

                    # Wait for process to exit (run in thread to avoid blocking event loop)
                    from config import ENGINE_SHUTDOWN_TIMEOUT
                    process = self.engine_processes[engine_name]
                    try:
                        await asyncio.wait_for(
                            asyncio.to_thread(process.wait),
                            timeout=ENGINE_SHUTDOWN_TIMEOUT
                        )
                        logger.info(f"{engine_name} server stopped gracefully (inactivity)")
                    except asyncio.TimeoutError:
                        logger.warning(f"{engine_name} server timeout, force killing...")
                        process.kill()
                        await asyncio.to_thread(process.wait)
                        logger.info(f"{engine_name} server force-killed (inactivity)")

                    # Cleanup
                    del self.engine_processes[engine_name]
                    if engine_name in self.engine_ports:
                        port = self.engine_ports[engine_name]
                        del self.engine_ports[engine_name]
                        # Release port from global registry
                        global _global_used_ports
                        _global_used_ports.discard(port)
                        logger.debug(f"Port {port} released from {engine_name} (inactivity)")

                    if self.active_engine == engine_name:
                        self.active_engine = None

                    # Remove from activity tracking
                    del self._last_activity[engine_name]

                    # Emit engine stopped event with "inactivity" reason
                    try:
                        await emit_engine_stopped(self.engine_type, engine_name, reason="inactivity")
                    except Exception as e:
                        logger.warning(f"Failed to broadcast engine stop event: {e}")

                except Exception as e:
                    logger.error(f"Failed to auto-stop {engine_name}: {e}")
                finally:
                    # Always remove from stopping state
                    self._stopping_engines.discard(engine_name)
                    logger.debug(f"Engine {engine_name} removed from 'stopping' state (inactivity)")

    def __repr__(self) -> str:
        """String representation for debugging"""
        running = ', '.join(self.engine_processes.keys()) or 'none'
        return (
            f"<{self.__class__.__name__} "
            f"type={self.engine_type} "
            f"available={len(self._engine_metadata)} "
            f"running={len(self.engine_processes)} ({running}) "
            f"active={self.active_engine}>"
        )
