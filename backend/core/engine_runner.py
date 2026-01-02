"""
EngineRunner Abstraction - Pluggable engine lifecycle management

Provides a common interface for starting/stopping engines regardless of
execution method (subprocess, local Docker, remote Docker).

This enables dual-mode operation:
- LocalRunner: Existing subprocess-based execution (development, simple setup)
- DockerRunner: Local Docker containers (production)
- RemoteDockerRunner: Remote Docker via SSH (GPU servers, distributed systems)
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass
class EngineEndpoint:
    """
    Result of starting an engine.

    Contains the base URL for HTTP communication and optional container ID
    for Docker-based runners.

    Attributes:
        base_url: HTTP endpoint (e.g., "http://127.0.0.1:8766" or "http://gpu-server:8766")
        container_id: Docker container ID (only for Docker runners)
    """
    base_url: str
    container_id: Optional[str] = None


class EngineRunner(ABC):
    """
    Abstract base class for engine lifecycle management.

    Implementations handle starting, stopping, and monitoring engines
    using different execution methods (subprocess, Docker, remote Docker).

    All runners expose the same interface, allowing BaseEngineManager to
    work with any runner type transparently.
    """

    @abstractmethod
    async def start(
        self,
        variant_id: str,
        engine_type: str,
        config: dict
    ) -> EngineEndpoint:
        """
        Start an engine and return its endpoint.

        Args:
            variant_id: Variant identifier (e.g., "xtts:local", "xtts:docker:local")
            engine_type: Engine category (e.g., "tts", "stt", "text", "audio")
            config: Engine-specific configuration:
                - port: HTTP port to use
                - model_path: Path to model files (if applicable)
                - gpu: Whether to enable GPU support
                - models_volume: Path to models volume (Docker only)
                - image_tag: Docker image tag (Docker only)

        Returns:
            EngineEndpoint with base_url for HTTP communication

        Raises:
            RuntimeError: If engine fails to start or health check times out
        """
        pass

    @abstractmethod
    async def stop(self, variant_id: str) -> None:
        """
        Stop a running engine.

        Args:
            variant_id: Variant identifier to stop

        Raises:
            RuntimeError: If engine not running or stop fails
        """
        pass

    @abstractmethod
    def is_running(self, variant_id: str) -> bool:
        """
        Check if an engine is currently running.

        Args:
            variant_id: Variant identifier to check

        Returns:
            True if engine is running, False otherwise
        """
        pass

    @abstractmethod
    def get_endpoint(self, variant_id: str) -> Optional[EngineEndpoint]:
        """
        Get the endpoint of a running engine.

        Args:
            variant_id: Variant identifier

        Returns:
            EngineEndpoint if engine is running, None otherwise
        """
        pass
