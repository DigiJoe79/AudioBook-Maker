"""
Engine Variant Models

Data models for engine variants that combine engine + runner.

Variant ID Format:
    - "{engine_name}:local"           - Local subprocess
    - "{engine_name}:docker:local"    - Docker on local host
    - "{engine_name}:docker:{host}"   - Docker on remote host
"""

from dataclasses import dataclass
from typing import Optional, Literal


RunnerType = Literal["subprocess", "docker:local", "docker:remote"]
SourceType = Literal["local", "docker"]


@dataclass
class EngineVariantId:
    """
    Parsed engine variant identifier.

    Represents a unique engine+runner combination.

    Attributes:
        engine_name: Base engine name (e.g., 'xtts', 'whisper')
        runner_id: Full runner identifier (e.g., 'local', 'docker:local')
        runner_type: Runner type classification
        runner_host: Docker host name (for docker runners)
    """
    engine_name: str
    runner_id: str
    runner_type: RunnerType
    runner_host: Optional[str] = None

    @property
    def source(self) -> SourceType:
        """Get source type: 'local' for subprocess, 'docker' for containers."""
        return "local" if self.runner_type == "subprocess" else "docker"

    def __str__(self) -> str:
        """Convert back to variant_id string."""
        return f"{self.engine_name}:{self.runner_id}"


def parse_variant_id(variant_id: str) -> EngineVariantId:
    """
    Parse a variant ID string into structured components.

    Args:
        variant_id: Variant identifier string (e.g., 'xtts:docker:local')

    Returns:
        Parsed EngineVariantId

    Raises:
        ValueError: If variant_id is empty or invalid
    """
    if not variant_id:
        raise ValueError("Variant ID cannot be empty")

    parts = variant_id.split(":", maxsplit=1)
    if len(parts) < 2:
        raise ValueError(f"Invalid variant ID format: {variant_id}")

    engine_name = parts[0]
    runner_part = parts[1]

    # Determine runner type and host
    if runner_part == "local":
        return EngineVariantId(
            engine_name=engine_name,
            runner_id="local",
            runner_type="subprocess",
            runner_host=None
        )
    elif runner_part.startswith("docker:"):
        host = runner_part.split(":", maxsplit=1)[1]
        runner_type: RunnerType = "docker:local" if host == "local" else "docker:remote"
        return EngineVariantId(
            engine_name=engine_name,
            runner_id=runner_part,
            runner_type=runner_type,
            runner_host=host
        )
    else:
        # Assume custom runner
        return EngineVariantId(
            engine_name=engine_name,
            runner_id=runner_part,
            runner_type="subprocess",
            runner_host=None
        )


def get_host_id_from_variant(variant: EngineVariantId) -> str | None:
    """
    Get the engine_hosts host_id from a parsed variant.

    With consistent host_id format (docker:local, docker:abc123),
    the runner_id directly matches the database host_id.

    Args:
        variant: Parsed EngineVariantId

    Returns:
        Host ID for docker_service functions, or None for subprocess variants

    Examples:
        - runner_id='docker:local' -> 'docker:local'
        - runner_id='docker:abc123' -> 'docker:abc123'
        - runner_type='subprocess' -> None
    """
    if variant.runner_type == "subprocess":
        return None

    # runner_id is the host_id (docker:local or docker:abc123)
    return variant.runner_id
