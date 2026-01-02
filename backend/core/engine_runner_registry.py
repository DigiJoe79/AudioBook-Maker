"""
EngineRunnerRegistry - Manages runner assignments per engine

Provides a central registry for:
1. Registering runner implementations (local, docker:local, docker:gpu-server)
2. Assigning engines to specific runners
3. Looking up the appropriate runner for each engine

This enables flexible deployment configurations:
- All local: DEFAULT_ENGINE_RUNNER=local
- All Docker: DEFAULT_ENGINE_RUNNER=docker
- Hybrid: xtts on remote GPU, rest local
"""

from pathlib import Path
from typing import Dict, Optional

from loguru import logger

from core.engine_runner import EngineRunner
from core.local_runner import LocalRunner


class EngineRunnerRegistry:
    """
    Central registry for engine runner assignments.

    Manages which runner handles each engine's lifecycle. Defaults to
    LocalRunner for backward compatibility with existing deployments.

    Usage:
        registry = get_engine_runner_registry()
        runner = registry.get_runner('xtts')  # Returns assigned runner or 'local'
        endpoint = await runner.start('xtts', 'tts', config)

    Attributes:
        runners: Dictionary of runner_id -> EngineRunner instances
        engine_assignments: Dictionary of engine_name -> runner_id
    """

    def __init__(self, engines_base_path: Optional[Path] = None):
        """
        Initialize registry with default LocalRunner.

        Args:
            engines_base_path: Base path for LocalRunner (defaults to backend/engines/)
        """
        self.runners: Dict[str, EngineRunner] = {}
        self.engine_assignments: Dict[str, str] = {}

        # Determine engines base path
        if engines_base_path is None:
            engines_base_path = Path(__file__).parent.parent / 'engines'

        # Register default LocalRunner
        self.runners['local'] = LocalRunner(engines_base_path)
        logger.debug(f"[Registry] Initialized with LocalRunner (path: {engines_base_path})")

    def register_runner(self, runner_id: str, runner: EngineRunner) -> None:
        """
        Register a runner implementation.

        Args:
            runner_id: Unique identifier (e.g., 'local', 'docker:local', 'docker:gpu-server')
            runner: EngineRunner implementation instance
        """
        self.runners[runner_id] = runner
        logger.info(f"[Registry] Registered runner: {runner_id}")

    def unregister_runner(self, runner_id: str) -> None:
        """
        Unregister a runner.

        Args:
            runner_id: Runner to remove

        Note:
            Cannot unregister 'local' runner (always required as fallback)
        """
        if runner_id == 'local':
            logger.warning("[Registry] Cannot unregister 'local' runner")
            return

        if runner_id in self.runners:
            del self.runners[runner_id]
            logger.info(f"[Registry] Unregistered runner: {runner_id}")

            # Clear assignments to this runner
            engines_to_clear = [
                engine for engine, rid in self.engine_assignments.items()
                if rid == runner_id
            ]
            for engine in engines_to_clear:
                del self.engine_assignments[engine]
                logger.debug(f"[Registry] Cleared assignment for {engine} (runner removed)")

    def assign_engine(self, engine_name: str, runner_id: str) -> None:
        """
        Assign an engine to a specific runner.

        Args:
            engine_name: Engine identifier (e.g., 'xtts', 'whisper')
            runner_id: Runner to use for this engine

        Raises:
            ValueError: If runner_id is not registered
        """
        if runner_id not in self.runners:
            raise ValueError(f"Unknown runner: {runner_id}. Registered: {list(self.runners.keys())}")

        old_runner = self.engine_assignments.get(engine_name)
        self.engine_assignments[engine_name] = runner_id

        if old_runner != runner_id:
            logger.info(f"[Registry] Engine {engine_name} assigned to runner: {runner_id}")

    def clear_assignment(self, engine_name: str) -> None:
        """
        Clear runner assignment for an engine (reverts to default 'local').

        Args:
            engine_name: Engine to clear assignment for
        """
        if engine_name in self.engine_assignments:
            del self.engine_assignments[engine_name]
            logger.debug(f"[Registry] Cleared assignment for {engine_name}")

    def get_runner(self, engine_name: str) -> EngineRunner:
        """
        Get the runner for a specific engine.

        Args:
            engine_name: Engine identifier

        Returns:
            Assigned runner, or 'local' runner if no assignment
        """
        runner_id = self.engine_assignments.get(engine_name, 'local')
        return self.runners[runner_id]

    def get_runner_id(self, engine_name: str) -> str:
        """
        Get the runner ID for a specific engine.

        Args:
            engine_name: Engine identifier

        Returns:
            Runner ID (e.g., 'local', 'docker:local')
        """
        return self.engine_assignments.get(engine_name, 'local')

    def get_runner_id_by_variant(self, variant_id: str) -> str:
        """
        Get the runner ID from a variant_id.

        For local variants (e.g., 'xtts:local'), uses engine assignments.
        For docker variants (e.g., 'xtts:docker:local'), extracts runner from variant_id.

        Args:
            variant_id: Full variant identifier (e.g., 'xtts:local', 'xtts:docker:local')

        Returns:
            Runner ID (e.g., 'local', 'docker:local')
        """
        parts = variant_id.split(':', 1)
        if len(parts) < 2:
            return 'local'

        engine_name = parts[0]
        runner_part = parts[1]

        # If runner_part starts with 'docker:', it's a docker variant
        if runner_part.startswith('docker:'):
            return runner_part  # e.g., 'docker:local', 'docker:gpu-server'

        # For 'local' or custom runners, check assignments
        if runner_part == 'local':
            return self.engine_assignments.get(engine_name, 'local')

        return runner_part

    def get_runner_by_variant(self, variant_id: str) -> EngineRunner:
        """
        Get the runner for a variant_id.

        Args:
            variant_id: Full variant identifier (e.g., 'xtts:local', 'xtts:docker:local')

        Returns:
            EngineRunner instance for this variant
        """
        runner_id = self.get_runner_id_by_variant(variant_id)

        # Fall back to local if runner not registered
        if runner_id not in self.runners:
            logger.warning(f"[Registry] Runner '{runner_id}' not registered, falling back to 'local'")
            return self.runners['local']

        return self.runners[runner_id]

    def list_runners(self) -> Dict[str, str]:
        """
        List all registered runners.

        Returns:
            Dictionary of runner_id -> runner class name
        """
        return {rid: type(r).__name__ for rid, r in self.runners.items()}

    def load_assignments_from_settings(self) -> int:
        """
        Load engine runner assignments from settings database.

        Called at startup to restore persisted assignments.

        Returns:
            Number of assignments loaded
        """
        from db.database import get_db_connection_simple
        from services.settings_service import SettingsService

        try:
            conn = get_db_connection_simple()
            settings_service = SettingsService(conn)

            count = 0
            # Load assignments for each engine type
            for engine_type in ['tts', 'stt', 'text', 'audio']:
                settings = settings_service.get_setting(engine_type)
                if not settings:
                    continue

                engines = settings.get('engines', {})
                for engine_name, config in engines.items():
                    runner_id = config.get('runner')
                    if runner_id and runner_id in self.runners:
                        self.engine_assignments[engine_name] = runner_id
                        logger.debug(f"[Registry] Loaded assignment: {engine_name} -> {runner_id}")
                        count += 1

            if count > 0:
                logger.info(f"[Registry] Loaded {count} runner assignments from settings")
            return count

        except Exception as e:
            logger.warning(f"[Registry] Failed to load assignments from settings: {e}")
            return 0


# Singleton instance
_registry_instance: Optional[EngineRunnerRegistry] = None


def get_engine_runner_registry() -> EngineRunnerRegistry:
    """
    Get the global EngineRunnerRegistry singleton.

    Returns:
        The shared registry instance
    """
    global _registry_instance
    if _registry_instance is None:
        _registry_instance = EngineRunnerRegistry()
    return _registry_instance


def reset_engine_runner_registry() -> None:
    """Reset the registry (for testing)."""
    global _registry_instance
    _registry_instance = None
