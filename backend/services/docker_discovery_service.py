"""
Docker Discovery Service - Discover Engine Metadata from Docker Images

This service starts temporary Docker containers, queries their /info endpoint,
validates the response against EngineYamlSchema, and returns the validated metadata.

Workflow:
1. Find free port (18000-18100 range)
2. Start container via Docker SDK
3. Poll /health endpoint until ready (max 90s timeout for PyTorch engines)
4. Query /info endpoint for engine metadata
5. Validate response against EngineYamlSchema
6. Stop and remove container
7. Return validated engine metadata

Usage:
    service = DockerDiscoveryService()
    result = await service.discover_engine("ghcr.io/user/engine-image", "latest")
    if result.success:
        print(f"Engine: {result.engine_info.name}")
    else:
        print(f"Error: {result.error}")
"""

import asyncio
import os
import re
import socket
from typing import Any, Dict, List, Optional, Union
from loguru import logger
from pydantic import ValidationError

import docker
import docker.errors

from core.exceptions import ApplicationError
from models.engine_schema import EngineYamlSchema, validate_yaml_dict
from models.response_models import CamelCaseModel


# ============================================================================
# Utility Functions
# ============================================================================

def _camel_to_snake(name: str) -> str:
    """Convert camelCase to snake_case."""
    # Insert underscore before uppercase letters and lowercase them
    s1 = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
    return re.sub('([a-z0-9])([A-Z])', r'\1_\2', s1).lower()


def _convert_keys_to_snake_case(data: Union[Dict, List, Any]) -> Union[Dict, List, Any]:
    """
    Recursively convert all dict keys from camelCase to snake_case.

    Engine servers use CamelCaseModel (returns camelCase JSON),
    but EngineYamlSchema expects snake_case (YAML convention).
    This function bridges the gap for /info endpoint responses.
    """
    if isinstance(data, dict):
        return {
            _camel_to_snake(key): _convert_keys_to_snake_case(value)
            for key, value in data.items()
        }
    elif isinstance(data, list):
        return [_convert_keys_to_snake_case(item) for item in data]
    else:
        return data


# ============================================================================
# Response Models
# ============================================================================

class DiscoveryResult(CamelCaseModel):
    """
    Result of Docker engine discovery operation.

    Contains either validated engine metadata or error details.
    Used internally by Docker Discovery Service and returned via API endpoints.
    """
    success: bool
    engine_info: Optional[EngineYamlSchema] = None
    error: Optional[str] = None
    docker_image: str
    docker_tag: str


# ============================================================================
# Docker Discovery Service
# ============================================================================

class DockerDiscoveryService:
    """
    Service for discovering engine metadata from Docker images.

    Provides automated discovery of custom Docker engines by:
    - Starting temporary containers
    - Querying their /info endpoint
    - Validating metadata against EngineYamlSchema
    - Cleaning up resources

    Uses Docker Python SDK for container operations (works via socket, supports remote hosts).
    """

    # Port range for temporary discovery containers
    PORT_RANGE_START = 18000
    PORT_RANGE_END = 18100

    # Health check configuration
    HEALTH_CHECK_INTERVAL = 0.5  # seconds
    HEALTH_CHECK_TIMEOUT = 90.0  # seconds (PyTorch engines like Chatterbox need 60-90s)

    def __init__(self, docker_url: Optional[str] = None):
        """
        Initialize Docker Discovery Service.

        Args:
            docker_url: Docker daemon URL (None = use default from environment/socket)
        """
        self.httpx_client = None
        self.docker_client: Optional[docker.DockerClient] = None
        self.docker_url = docker_url

        # Host to reach engine containers from this process
        # - "127.0.0.1" when running directly on host
        # - "host.docker.internal" when running inside a container (Docker-in-Docker)
        self.engine_host = os.getenv("DOCKER_ENGINE_HOST", "127.0.0.1")

    def _get_docker_client(self) -> docker.DockerClient:
        """
        Get or create Docker client.

        Returns:
            Docker client instance

        Raises:
            RuntimeError: If Docker is not available
        """
        if self.docker_client is None:
            try:
                if self.docker_url:
                    self.docker_client = docker.DockerClient(base_url=self.docker_url)
                else:
                    self.docker_client = docker.from_env()
                self.docker_client.ping()
                logger.debug("[DockerDiscovery] Connected to Docker daemon")
            except docker.errors.DockerException as e:
                logger.error(f"[DockerDiscovery] Failed to connect to Docker: {e}")
                raise ApplicationError("DOCKER_NOT_AVAILABLE", status_code=503, error=str(e))
        return self.docker_client

    async def _get_httpx_client(self):
        """Get or create httpx async client."""
        if self.httpx_client is None:
            import httpx
            self.httpx_client = httpx.AsyncClient(timeout=10.0)
        return self.httpx_client

    async def _close_httpx_client(self):
        """Close httpx client if it exists."""
        if self.httpx_client is not None:
            await self.httpx_client.aclose()
            self.httpx_client = None

    def _find_free_port(self) -> Optional[int]:
        """
        Find a free port in the discovery port range.

        Tries ports sequentially from PORT_RANGE_START to PORT_RANGE_END.

        Returns:
            Free port number or None if no ports available
        """
        logger.debug(
            "[DockerDiscovery] Finding free port",
            range_start=self.PORT_RANGE_START,
            range_end=self.PORT_RANGE_END,
        )
        for port in range(self.PORT_RANGE_START, self.PORT_RANGE_END + 1):
            try:
                # Try to bind to the port
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.bind(("127.0.0.1", port))
                    # If successful, port is free
                    logger.debug("[DockerDiscovery] Found free port", port=port)
                    return port
            except OSError:
                # Port is in use, try next
                continue

        logger.debug("[DockerDiscovery] No free ports available in range")
        return None

    async def _wait_for_health(self, port: int, timeout: float = HEALTH_CHECK_TIMEOUT) -> bool:
        """
        Wait for container to become healthy by polling /health endpoint.

        Args:
            port: Container port to check
            timeout: Maximum time to wait in seconds

        Returns:
            True if container became healthy, False if timeout
        """
        import httpx

        client = await self._get_httpx_client()
        url = f"http://{self.engine_host}:{port}/health"

        start_time = asyncio.get_event_loop().time()

        while (asyncio.get_event_loop().time() - start_time) < timeout:
            try:
                response = await client.get(url)

                if response.status_code == 200:
                    data = response.json()

                    # Check if status is "ready"
                    if data.get("status") == "ready":
                        logger.info(f"Container health check passed on port {port}")
                        return True

                    logger.debug(f"Container status: {data.get('status')}")

            except (httpx.ConnectError, httpx.TimeoutException):
                # Connection failed, container not ready yet
                pass
            except Exception as e:
                logger.debug(f"Health check error: {e}")

            # Wait before next check
            await asyncio.sleep(self.HEALTH_CHECK_INTERVAL)

        logger.warning(f"Container health check timeout after {timeout}s")
        return False

    async def _query_info_endpoint(self, port: int) -> Optional[dict]:
        """
        Query the /info endpoint of a running container.

        Args:
            port: Container port

        Returns:
            JSON response dict or None if request failed
        """

        client = await self._get_httpx_client()
        url = f"http://{self.engine_host}:{port}/info"

        try:
            response = await client.get(url)

            if response.status_code == 200:
                return response.json()
            else:
                logger.error(f"/info endpoint returned status {response.status_code}")
                return None

        except Exception as e:
            logger.error(f"Failed to query /info endpoint: {e}")
            return None

    async def _start_container(self, docker_image: str, docker_tag: str, port: int) -> Optional[str]:
        """
        Start a Docker container for discovery.

        Args:
            docker_image: Full image name (e.g., 'ghcr.io/user/engine-image')
            docker_tag: Image tag
            port: Host port to map to container port 8766

        Returns:
            Container ID or None if start failed
        """
        full_image = f"{docker_image}:{docker_tag}"

        logger.info(f"[DockerDiscovery] Starting discovery container: {full_image} on port {port}")

        try:
            client = self._get_docker_client()

            # Check if image exists locally, pull if not
            try:
                client.images.get(full_image)
                logger.debug(f"[DockerDiscovery] Image {full_image} found locally")
            except docker.errors.ImageNotFound:
                logger.info(f"[DockerDiscovery] Pulling image {full_image}...")
                client.images.pull(docker_image, tag=docker_tag)

            # Pass PORT env var so container listens on the assigned port
            # This mirrors DockerRunner behavior - container adapts to assigned port
            container = await asyncio.to_thread(
                client.containers.run,
                full_image,
                detach=True,
                ports={f'{port}/tcp': port},
                environment={'PORT': str(port)},
                remove=True  # Auto-cleanup after stop
            )

            logger.debug(f"[DockerDiscovery] Container started: {container.short_id}")
            return container.id

        except docker.errors.ImageNotFound as e:
            logger.error(f"[DockerDiscovery] Image not found: {e}")
            return None
        except docker.errors.APIError as e:
            logger.error(f"[DockerDiscovery] Docker API error: {e}")
            return None
        except Exception as e:
            logger.error(f"[DockerDiscovery] Failed to start container: {e}")
            return None

    async def _stop_and_remove_container(self, container_id: str) -> None:
        """
        Stop and remove a Docker container.

        Args:
            container_id: Container ID to remove
        """
        if not container_id:
            return

        logger.debug(f"[DockerDiscovery] Stopping container {container_id[:12]}")

        try:
            client = self._get_docker_client()
            container = client.containers.get(container_id)

            # Stop container (timeout 5s) - run in thread to avoid blocking
            await asyncio.to_thread(container.stop, timeout=5)
            logger.debug(f"[DockerDiscovery] Container {container_id[:12]} stopped")

            # Container was started with remove=True, so it auto-removes after stop
            # No need to call remove() explicitly - it would cause a 409 Conflict
            logger.debug(f"[DockerDiscovery] Container {container_id[:12]} stopped (auto-remove enabled)")

        except docker.errors.NotFound:
            logger.debug(f"[DockerDiscovery] Container {container_id[:12]} not found (already removed)")
        except docker.errors.APIError as e:
            if e.status_code == 409:
                # Container removal already in progress (expected with auto-remove)
                logger.debug(f"[DockerDiscovery] Container {container_id[:12]} removal already in progress")
            else:
                logger.warning(f"[DockerDiscovery] Docker API error for container {container_id[:12]}: {e}")
        except Exception as e:
            logger.warning(f"[DockerDiscovery] Failed to stop container {container_id[:12]}: {e}")

    async def discover_engine(
        self,
        docker_image: str,
        docker_tag: str = "latest"
    ) -> DiscoveryResult:
        """
        Discover engine metadata from a Docker image.

        Workflow:
        1. Find free port in range 18000-18100
        2. Start temporary container
        3. Wait for /health endpoint to report "ready" (max 90s for PyTorch engines)
        4. Query /info endpoint
        5. Validate response against EngineYamlSchema
        6. Stop and remove container (always, even on error)
        7. Return validated metadata or error

        Args:
            docker_image: Full Docker image name (e.g., 'ghcr.io/user/engine')
            docker_tag: Image tag (default: 'latest')

        Returns:
            DiscoveryResult with success flag, engine_info (if successful), and error details

        Example:
            result = await service.discover_engine("ghcr.io/user/xtts", "v2.0")
            if result.success:
                print(f"Discovered engine: {result.engine_info.name}")
            else:
                print(f"Discovery failed: {result.error}")
        """
        container_id: Optional[str] = None

        logger.debug(
            "[DockerDiscovery] Starting discovery",
            image=docker_image,
            tag=docker_tag,
        )

        try:
            # Step 1: Find free port
            port = self._find_free_port()
            if port is None:
                return DiscoveryResult(
                    success=False,
                    error=f"No free ports available in range {self.PORT_RANGE_START}-{self.PORT_RANGE_END}",
                    docker_image=docker_image,
                    docker_tag=docker_tag
                )

            # Step 2: Start container
            container_id = await self._start_container(docker_image, docker_tag, port)
            if container_id is None:
                return DiscoveryResult(
                    success=False,
                    error="Failed to start Docker container (check docker logs for details)",
                    docker_image=docker_image,
                    docker_tag=docker_tag
                )

            # Step 3: Wait for health check
            is_healthy = await self._wait_for_health(port)
            if not is_healthy:
                return DiscoveryResult(
                    success=False,
                    error=f"Container failed to become healthy within {self.HEALTH_CHECK_TIMEOUT}s",
                    docker_image=docker_image,
                    docker_tag=docker_tag
                )

            # Step 4: Query /info endpoint
            info_data = await self._query_info_endpoint(port)
            if info_data is None:
                return DiscoveryResult(
                    success=False,
                    error="Failed to query /info endpoint (no response)",
                    docker_image=docker_image,
                    docker_tag=docker_tag
                )

            # Step 5: Convert camelCase → snake_case and validate against EngineYamlSchema
            # Engine servers use CamelCaseModel (camelCase JSON), but EngineYamlSchema expects snake_case
            try:
                logger.debug(
                    "[DockerDiscovery] Parsing metadata from /info",
                    raw_keys=list(info_data.keys()) if isinstance(info_data, dict) else "not_a_dict",
                )
                snake_case_data = _convert_keys_to_snake_case(info_data)
                logger.debug(
                    "[DockerDiscovery] Converted to snake_case",
                    name=snake_case_data.get("name"),
                    engine_type=snake_case_data.get("engine_type"),
                    variant_count=len(snake_case_data.get("variants", [])),
                )
                validated_info = validate_yaml_dict(snake_case_data)

                # Match variant to docker_tag and override requires_gpu
                # This is needed because engine.yaml contains ALL variants,
                # but we need the specific requires_gpu for the queried tag
                if validated_info.variants:
                    for variant in validated_info.variants:
                        if variant.tag == docker_tag:
                            validated_info.requires_gpu = variant.requires_gpu
                            logger.debug(
                                f"[DockerDiscovery] Matched variant '{docker_tag}' -> "
                                f"requires_gpu={variant.requires_gpu}"
                            )
                            break

                logger.info(
                    f"Successfully discovered engine: {validated_info.name} "
                    f"(type: {validated_info.engine_type}, requires_gpu={validated_info.requires_gpu})"
                )

                return DiscoveryResult(
                    success=True,
                    engine_info=validated_info,
                    docker_image=docker_image,
                    docker_tag=docker_tag
                )

            except ValidationError as e:
                logger.error(f"Engine metadata validation failed: {e}")
                return DiscoveryResult(
                    success=False,
                    error=f"Engine metadata validation failed: {str(e)}",
                    docker_image=docker_image,
                    docker_tag=docker_tag
                )

        except Exception as e:
            logger.error(f"Discovery failed with unexpected error: {e}")
            import traceback
            logger.error(traceback.format_exc())

            return DiscoveryResult(
                success=False,
                error=f"Unexpected error during discovery: {str(e)}",
                docker_image=docker_image,
                docker_tag=docker_tag
            )

        finally:
            # Step 6: Always clean up container
            if container_id:
                try:
                    await self._stop_and_remove_container(container_id)
                except Exception as e:
                    logger.error(f"Failed to clean up container {container_id[:12]}: {e}")

            # Close httpx client
            await self._close_httpx_client()


# ============================================================================
# Singleton Instance (optional)
# ============================================================================

_docker_discovery_service: Optional[DockerDiscoveryService] = None


def get_docker_discovery_service() -> DockerDiscoveryService:
    """
    Get singleton instance of DockerDiscoveryService.

    Returns:
        DockerDiscoveryService instance
    """
    global _docker_discovery_service

    if _docker_discovery_service is None:
        _docker_discovery_service = DockerDiscoveryService()

    return _docker_discovery_service
