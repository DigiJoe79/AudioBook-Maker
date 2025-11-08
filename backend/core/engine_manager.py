"""
TTS Engine Manager - Process Manager for Engine Servers

Manages the lifecycle of TTS engine servers running in separate processes/VENVs.
Each engine runs as a standalone FastAPI server with its own dependencies.

Architecture:
    EngineManager (Singleton)
    ├── Engine Discovery (automatic scanning of engines/)
    ├── Process Management (start/stop engine servers)
    ├── HTTP Communication (REST API to engines)
    ├── Health Monitoring (track engine status)
    └── Preferred Engine (warm-keeping)

Usage:
    from backend.core.engine_manager import get_engine_manager

    manager = get_engine_manager()

    # Ensure engine is ready
    await manager.ensure_engine_ready('xtts', 'v2.0.3')

    # Generate audio via HTTP
    audio_bytes = await manager.generate_with_engine(
        'xtts',
        text='Hello world',
        language='en',
        speaker_wav='/path/to/sample.wav',
        parameters={}
    )

Author: Engine Server Architecture Migration
Date: 2025-11-03
"""
import os
import socket
import subprocess
import asyncio
from typing import Dict, List, Optional, Any, Union
from pathlib import Path
from loguru import logger
import httpx

from core.engine_discovery import EngineDiscovery


class EngineManager:
    """
    TTS Engine Manager with Process Management

    Manages engine servers as separate processes, communicating via HTTP.
    Each engine runs in its own VENV with isolated dependencies.

    Features:
    - Automatic engine discovery from engines/ directory
    - Process lifecycle management (start/stop servers)
    - HTTP client for engine communication
    - Health monitoring and auto-recovery
    - Preferred engine warm-keeping
    - Auto-find free ports

    Attributes:
        engine_metadata: Dictionary of discovered engine metadata
        engine_processes: Running engine server processes
        engine_ports: Assigned ports for each engine
        active_engine: Currently loaded engine name
        preferred_engine_config: User's preferred engine for warm-keeping
        http_client: Async HTTP client for engine communication
    """

    @staticmethod
    def _discover_engines() -> Dict[str, Any]:
        """
        Discover engines via AUTO-DISCOVERY

        Scans engines/ directory for engine server implementations.

        Returns:
            Dictionary mapping engine_name -> engine_metadata
        """
        try:
            from config import BACKEND_ROOT

            engines_path = Path(BACKEND_ROOT) / 'engines'
            discovery = EngineDiscovery(engines_path)
            engines = discovery.discover_all()

            if not engines:
                logger.warning("No engines discovered! Check engines/ directory.")
            else:
                logger.info(
                    f"Auto-discovered {len(engines)} engines: {list(engines.keys())}"
                )

            return engines
        except Exception as e:
            logger.error(f"Engine discovery failed: {e}")
            return {}

    # Shared engine metadata (built via discovery)
    _engine_metadata: Dict[str, Any] = {}

    def __init__(self):
        """
        Initialize Engine Manager

        Note: Use get_engine_manager() instead of direct instantiation
        to ensure singleton pattern.
        """
        # Build metadata on first instantiation
        if not self._engine_metadata:
            self.__class__._engine_metadata = self._discover_engines()

        # Process management
        self.engine_processes: Dict[str, subprocess.Popen] = {}
        self.engine_ports: Dict[str, int] = {}
        self.active_engine: Optional[str] = None

        # Preferred engine (RAM only, session-based)
        self.preferred_engine_config: Optional[Dict[str, str]] = None  # {"engine": "xtts", "model": "v2.0.3"}
        self._preferred_engine_task: Optional[asyncio.Task] = None  # Debouncing timer task

        # HTTP client for engine communication (5min timeout for generation)
        self.http_client = httpx.AsyncClient(timeout=300.0)

        logger.info(
            f"EngineManager initialized with {len(self._engine_metadata)} "
            f"available engines: {', '.join(self._engine_metadata.keys())}"
        )

    def list_available_engines(self) -> List[str]:
        """
        Get list of all available engine names

        Returns:
            List of engine identifiers 
        """
        return list(self._engine_metadata.keys())

    def get_engine_info(self, engine_type: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Get metadata for all engines or specific engine

        Args:
            engine_type: Specific engine to query, or None for all engines

        Returns:
            List of engine info dictionaries
        """
        engine_types = [engine_type] if engine_type else self.list_available_engines()

        info_list = []
        for etype in engine_types:
            if etype not in self._engine_metadata:
                logger.warning(f"Unknown engine type: {etype}")
                continue

            metadata = self._engine_metadata[etype]
            info_list.append({
                'name': metadata.get('name', etype),
                'display_name': metadata.get('display_name', etype),
                'version': metadata.get('version', 'unknown'),
                'capabilities': metadata.get('capabilities', {}),
                'constraints': metadata.get('constraints', {}),
                'supported_languages': metadata.get('supported_languages', []),
                'is_running': etype in self.engine_processes,
                'port': self.engine_ports.get(etype)
            })

        return info_list

    def get_available_models(self, engine_type: str) -> List[Dict[str, Any]]:
        """
        Get list of available models for a specific engine

        Args:
            engine_type: Engine identifier 

        Returns:
            List of model dictionaries with metadata

        Raises:
            ValueError: If engine_type is unknown
        """
        if engine_type not in self._engine_metadata:
            available = ', '.join(self._engine_metadata.keys())
            raise ValueError(
                f"Unknown engine type: '{engine_type}'. "
                f"Available engines: {available}"
            )

        metadata = self._engine_metadata[engine_type]
        return metadata.get('models', [])

    def find_free_port(self, start: int = 8766) -> int:
        """
        Find available port starting from given port

        Args:
            start: Starting port number

        Returns:
            First available port number
        """
        port = start
        while port < 65535:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                try:
                    sock.bind(('127.0.0.1', port))
                    return port
                except OSError:
                    port += 1
        raise RuntimeError("No free ports available")

    async def start_engine_server(self, engine_name: str, model_name: str) -> int:
        """
        Start engine server process and wait for health check

        Args:
            engine_name: Engine identifier (e.g., 'xtts')
            model_name: Model to load (e.g., 'v2.0.3')

        Returns:
            Port number the engine is listening on

        Raises:
            RuntimeError: If engine start fails or health check times out
        """
        if engine_name not in self._engine_metadata:
            raise ValueError(f"Unknown engine: {engine_name}")

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
            python_rel = python_exe.relative_to(backend_dir)
            script_rel = server_script.relative_to(backend_dir)
            logger.info(f"Starting {engine_name} server: {python_rel} {script_rel} --port {port}")
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
        logger.info(f"Waiting for {engine_name} server to be ready...")
        for attempt in range(30):
            await asyncio.sleep(1)

            try:
                health = await self.health_check(engine_name)
                if health.get('status') in ['ready', 'loading']:
                    logger.info(f"{engine_name} server ready on port {port}")

                    # Load model
                    await self._load_model(engine_name, model_name)

                    self.active_engine = engine_name
                    return port
            except Exception:
                pass  # Not ready yet

        # Timeout
        await self.stop_engine_server(engine_name)
        raise RuntimeError(f"{engine_name} server failed to start within 30s")

    async def _load_model(self, engine_name: str, model_name: str):
        """
        Call engine's /load endpoint to load model

        Args:
            engine_name: Engine identifier
            model_name: Model to load
        """
        port = self.engine_ports.get(engine_name)
        if not port:
            raise RuntimeError(f"Engine {engine_name} not running")

        url = f"http://127.0.0.1:{port}/load"

        logger.info(f"Loading model {model_name} on {engine_name}...")

        # Note: CamelCaseModel accepts both snake_case and camelCase (populate_by_name=True)
        # Using camelCase here for consistency with JSON API convention
        response = await self.http_client.post(url, json={"ttsModelName": model_name})
        response.raise_for_status()

        result = response.json()
        if result.get('status') != 'loaded':
            raise RuntimeError(f"Model loading failed: {result.get('error')}")

        logger.info(f"Model {model_name} loaded successfully on {engine_name}")

    async def stop_engine_server(self, engine_name: str, timeout: int = 30):
        """
        Gracefully stop engine via /shutdown, then kill if timeout

        Args:
            engine_name: Engine to stop
            timeout: Seconds to wait before force-kill
        """
        if engine_name not in self.engine_processes:
            logger.warning(f"Engine {engine_name} not running")
            return

        # Try graceful shutdown
        try:
            port = self.engine_ports.get(engine_name)
            if port:
                url = f"http://127.0.0.1:{port}/shutdown"
                await self.http_client.post(url, timeout=5.0)
                logger.info(f"Sent shutdown request to {engine_name}")
        except Exception as e:
            logger.warning(f"Graceful shutdown failed: {e}")

        # Wait for process to exit
        process = self.engine_processes[engine_name]
        try:
            process.wait(timeout=timeout)
            logger.info(f"{engine_name} server stopped gracefully")
        except subprocess.TimeoutExpired:
            logger.warning(f"{engine_name} server timeout, force killing...")
            process.kill()
            process.wait()
            logger.info(f"{engine_name} server force-killed")

        # Cleanup
        del self.engine_processes[engine_name]
        if engine_name in self.engine_ports:
            del self.engine_ports[engine_name]

        if self.active_engine == engine_name:
            self.active_engine = None

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
            logger.info(f"Engine {engine_name} not running, starting...")
            await self.start_engine_server(engine_name, model_name)
            return

        # Check current model
        health = await self.health_check(engine_name)
        current_model = health.get('currentTtsModel')

        # Same engine, same model - nothing to do
        if current_model == model_name:
            logger.debug(f"Engine {engine_name} already has {model_name} loaded")
            return

        # Same engine, different model - check if hotswap supported
        metadata = self._engine_metadata[engine_name]
        supports_hotswap = metadata.get('capabilities', {}).get('supports_model_hotswap', False)

        if supports_hotswap:
            logger.info(f"Hotswapping model on {engine_name}: {current_model} → {model_name}")
            await self._load_model(engine_name, model_name)
        else:
            # No hotswap - restart engine
            logger.info(f"Engine {engine_name} doesn't support hotswap, restarting...")
            await self.stop_engine_server(engine_name)
            await self.start_engine_server(engine_name, model_name)

    async def generate_with_engine(
        self,
        engine_name: str,
        text: str,
        language: str,
        speaker_wav: Union[str, List[str]],
        parameters: Dict[str, Any]
    ) -> bytes:
        """
        Call engine's /generate endpoint

        Args:
            engine_name: Engine identifier
            text: Text to synthesize
            language: Language code
            speaker_wav: Path(s) to speaker sample(s)
            parameters: Engine-specific parameters

        Returns:
            WAV audio as bytes

        Raises:
            RuntimeError: If engine not running or generation fails
        """
        port = self.engine_ports.get(engine_name)
        if not port:
            raise RuntimeError(f"Engine {engine_name} not running")

        url = f"http://127.0.0.1:{port}/generate"

        payload = {
            "text": text,
            "language": language,
            "ttsSpeakerWav": speaker_wav,
            "parameters": parameters
        }

        logger.debug(f"Generating audio with {engine_name}: {text[:50]}...")

        response = await self.http_client.post(url, json=payload)
        response.raise_for_status()

        audio_bytes = response.content
        logger.debug(f"Generated {len(audio_bytes)} bytes")

        return audio_bytes

    async def health_check(self, engine_name: str) -> Dict[str, Any]:
        """
        Call engine's /health endpoint

        Args:
            engine_name: Engine to check

        Returns:
            Health status dict

        Raises:
            httpx.RequestError: If health check fails
        """
        port = self.engine_ports.get(engine_name)
        if not port:
            raise RuntimeError(f"Engine {engine_name} not running")

        url = f"http://127.0.0.1:{port}/health"

        response = await self.http_client.get(url, timeout=5.0)
        response.raise_for_status()

        return response.json()

    def set_preferred_engine(self, engine_name: str, model_name: str):
        """
        Set user's preferred engine (RAM only, session-based)

        This preference is applied with 5s debouncing to allow users to
        change both engine and model without triggering multiple loads.

        Args:
            engine_name: Engine identifier
            model_name: Model name
        """
        # Cancel any pending activation task
        if self._preferred_engine_task and not self._preferred_engine_task.done():
            self._preferred_engine_task.cancel()
            logger.debug("Cancelled previous preferred engine activation")

        # Store new preference
        self.preferred_engine_config = {
            "engine": engine_name,
            "model": model_name
        }
        logger.info(f"Preferred engine set: {engine_name} / {model_name}")

        # Start debounced activation (5s delay)
        try:
            loop = asyncio.get_event_loop()
            self._preferred_engine_task = loop.create_task(
                self._delayed_apply_preferred_engine(delay=5.0)
            )
            logger.debug("Scheduled preferred engine activation in 5s")
        except RuntimeError:
            # No event loop running (e.g., during tests)
            logger.warning("No event loop available, preferred engine activation skipped")

    async def _delayed_apply_preferred_engine(self, delay: float = 5.0):
        """
        Internal: Apply preferred engine after delay (debouncing)

        Waits for specified delay, then checks if worker is idle before activating.
        This prevents activation during active jobs or pending queues.

        Args:
            delay: Seconds to wait before activation
        """
        try:
            await asyncio.sleep(delay)

            # Check if worker is idle (no active job)
            try:
                from core.tts_worker import get_tts_worker
                worker = get_tts_worker()

                if worker.current_job_id is not None:
                    logger.debug(f"Worker busy with job {worker.current_job_id}, skipping preferred engine activation")
                    return

            except Exception as e:
                logger.warning(f"Could not check worker status: {e}")
                # Continue anyway - better to activate than skip

            # Worker is idle, activate preferred engine
            await self.apply_preferred_engine()

        except asyncio.CancelledError:
            # Task was cancelled by new set_preferred_engine() call - this is expected
            logger.debug("Preferred engine activation cancelled (user changed selection)")
        except Exception as e:
            logger.error(f"Error during delayed preferred engine activation: {e}", exc_info=True)

    async def apply_preferred_engine(self):
        """
        Activate preferred engine if set and not already active

        Called by Worker after job completion (when queue is empty) or
        after debounced delay from set_preferred_engine().
        """
        if not self.preferred_engine_config:
            return

        engine_name = self.preferred_engine_config["engine"]
        model_name = self.preferred_engine_config["model"]

        # Check if already active with correct model
        if engine_name in self.engine_processes:
            health = await self.health_check(engine_name)
            if health.get('currentTtsModel') == model_name:
                logger.debug(f"Preferred engine already active: {engine_name}/{model_name}")
                return

        logger.info(f"Activating preferred engine: {engine_name}/{model_name}")
        await self.ensure_engine_ready(engine_name, model_name)

    async def load_default_engine(self):
        """
        Load default engine from settings at backend startup

        Called during lifespan startup to warm-keep the default engine.
        If a preferred engine is already set, it takes priority.
        """
        # If preferred engine is set, use that instead
        if self.preferred_engine_config:
            logger.info("Preferred engine already set, skipping default engine load")
            await self.apply_preferred_engine()
            return

        # Get default engine from settings
        try:
            from services.settings_service import SettingsService
            from db.database import get_db_connection_simple

            conn = get_db_connection_simple()
            settings_service = SettingsService(conn)
            tts_settings = settings_service.get_setting('tts')

            default_engine = tts_settings.get('defaultTtsEngine')
            default_model = tts_settings.get('defaultTtsModelName')

            if not default_engine or not default_model:
                logger.warning("No default engine/model in settings, skipping warm-keep")
                return

            # Validate engine exists
            if default_engine not in self._engine_metadata:
                logger.warning(f"Default engine '{default_engine}' not found, skipping warm-keep")
                return

            # Validate model exists
            available_models = self.get_available_models(default_engine)
            model_names = [m['tts_model_name'] for m in available_models]
            if default_model not in model_names:
                logger.warning(f"Default model '{default_model}' not found for {default_engine}, skipping warm-keep")
                return

            logger.info(f"Loading default engine at startup: {default_engine} / {default_model}")
            await self.ensure_engine_ready(default_engine, default_model)
            logger.info(f"✓ Default engine ready: {default_engine} / {default_model}")

        except Exception as e:
            logger.error(f"Failed to load default engine: {e}")
            # Don't raise - startup should continue even if engine loading fails

    async def shutdown_all_engines(self):
        """
        Stop all running engine servers (called on backend shutdown)
        """
        engine_names = list(self.engine_processes.keys())

        for engine_name in engine_names:
            logger.info(f"Shutting down {engine_name}...")
            await self.stop_engine_server(engine_name)

        logger.info(f"All engines shut down ({len(engine_names)} engines)")

    def rediscover_engines(self) -> Dict[str, Any]:
        """
        Re-discover engines from engines/ directory (Hot-Reload)

        Use Case: User installs new engine while backend is running

        Returns:
            Dictionary of newly discovered engines
        """
        logger.info("Re-discovering engines...")

        try:
            from config import BACKEND_ROOT

            engines_path = Path(BACKEND_ROOT) / 'engines'
            discovery = EngineDiscovery(engines_path)
            new_engines = discovery.discover_all()

            # Update metadata
            self.__class__._engine_metadata.update(new_engines)

            logger.info(
                f"Re-discovered {len(new_engines)} engines: {list(new_engines.keys())}"
            )

            return new_engines
        except Exception as e:
            logger.error(f"Engine re-discovery failed: {e}")
            return {}

    def get_active_engine_name(self) -> Optional[str]:
        """
        Get the name of the currently active engine

        Returns:
            Active engine name or None if no engine active
        """
        return self.active_engine

    def is_engine_running(self, engine_type: str) -> bool:
        """
        Check if an engine server is running

        Args:
            engine_type: Engine to check

        Returns:
            True if running, False otherwise
        """
        return engine_type in self.engine_processes

    def get_running_engines(self) -> List[str]:
        """
        Get list of currently running engine names

        Returns:
            List of engine names
        """
        return list(self.engine_processes.keys())

    async def cleanup(self):
        """Cleanup resources (HTTP client, processes)"""
        await self.shutdown_all_engines()
        await self.http_client.aclose()

    def __repr__(self) -> str:
        """String representation"""
        running = ', '.join(self.engine_processes.keys()) or 'none'
        return (
            f"<EngineManager "
            f"available={len(self._engine_metadata)} "
            f"running={len(self.engine_processes)} ({running}) "
            f"active={self.active_engine}>"
        )


# ==================== Singleton Factory ====================

_engine_manager: Optional[EngineManager] = None


def get_engine_manager() -> EngineManager:
    """
    Get or create the global EngineManager singleton instance

    This is the recommended way to access the EngineManager.
    Ensures only one manager instance exists across the application.

    Returns:
        EngineManager singleton instance

    Example:
        from backend.core.engine_manager import get_engine_manager

        manager = get_engine_manager()
        engines = manager.list_available_engines()
    """
    global _engine_manager

    if _engine_manager is None:
        _engine_manager = EngineManager()

    return _engine_manager


async def reset_engine_manager() -> None:
    """
    Reset the EngineManager singleton (for testing)

    WARNING: This will stop all engines and reset the manager.
    Only use in test scenarios or explicit cleanup.
    """
    global _engine_manager

    if _engine_manager is not None:
        await _engine_manager.cleanup()
        _engine_manager = None
        logger.info("EngineManager singleton reset")


# Backward compatibility aliases
TTSManager = EngineManager
get_tts_manager = get_engine_manager
