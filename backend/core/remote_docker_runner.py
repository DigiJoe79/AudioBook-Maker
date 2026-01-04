"""
RemoteDockerRunner - Remote Docker execution via SSH

Runs engines on remote Docker hosts via SSH tunnel.
Requires SSH key authentication (no password support).

Uses paramiko for SSH connections (via CustomSSHHTTPAdapter),
providing cross-platform compatibility (Windows + Linux).

Architecture:
- DockerHostMonitor owns ALL SSH connections
- RemoteDockerRunner gets client via callback, never creates own connections
- On ChannelException, RemoteDockerRunner asks DockerHostMonitor to reconnect
"""

import asyncio
import os
from typing import Callable, Dict, Optional, Union
from urllib.parse import urlparse

import docker
from docker.types import DeviceRequest
from loguru import logger

from core.engine_runner import EngineRunner, EngineEndpoint

# Type alias for client provider callback
ClientProvider = Callable[[], Optional[docker.DockerClient]]
ReconnectCallback = Callable[[], Optional[docker.DockerClient]]

# Inactivity timeout for image pulls (seconds)
# If no progress for this duration, abort the pull
PULL_INACTIVITY_TIMEOUT = 60

# Minimum percentage change before emitting progress event
# Prevents flooding SSE with too many events
PULL_PROGRESS_MIN_CHANGE = 2


def _parse_variant_id(variant_id: str) -> tuple[str, str]:
    """
    Parse variant_id to extract base engine name and runner_id.

    Examples:
        'xtts:docker:remote' -> ('xtts', 'docker:remote')
        'xtts:local' -> ('xtts', 'local')
    """
    parts = variant_id.split(':', 1)
    if len(parts) == 1:
        return parts[0], 'local'
    return parts[0], parts[1]


class RemoteDockerRunner(EngineRunner):
    """
    Runs engines on remote Docker hosts via SSH.

    Architecture:
    - Does NOT own the Docker client connection
    - Gets client via get_client callback from DockerHostMonitor
    - On ChannelException, calls reconnect callback, then retries

    Prerequisites:
    - DockerHostMonitor must be running and have connected to the host
    - SSH key must be configured via SSHKeyService

    Attributes:
        host_url: SSH URL (e.g., "ssh://user@192.168.1.100")
        host_name: Human-readable name for the host
        host_id: Host identifier (e.g., "docker:abc123")
        containers: Active container IDs by variant_id
        endpoints: EngineEndpoint instances for running containers by variant_id
    """

    def __init__(
        self,
        host_url: str,
        host_name: str,
        host_id: str,
        get_client: ClientProvider,
        reconnect: ReconnectCallback,
        image_prefix: str = "ghcr.io/audiobook-maker",
    ):
        """
        Initialize RemoteDockerRunner.

        Does NOT create its own SSH connection - uses callbacks to get
        the client from DockerHostMonitor, which owns all connections.

        Args:
            host_url: SSH URL (e.g., "ssh://user@192.168.1.100")
            host_name: Human-readable host name
            host_id: Host identifier for key lookup (e.g., "docker:abc123")
            get_client: Callback to get current DockerClient from DockerHostMonitor
            reconnect: Callback to request reconnection from DockerHostMonitor
            image_prefix: Docker image name prefix

        Raises:
            RuntimeError: If no client available
        """
        self.host_url = host_url
        self.host_name = host_name
        self.host_id = host_id
        self.image_prefix = image_prefix

        # Callbacks to DockerHostMonitor (single owner of SSH connections)
        self._get_client = get_client
        self._reconnect = reconnect

        self.containers: Dict[str, str] = {}
        self.endpoints: Dict[str, EngineEndpoint] = {}

        # Verify we have a valid client
        client = self._get_client()
        if not client:
            raise RuntimeError(f"No client available for {host_name}")

        logger.debug(
            "RemoteDockerRunner init - verifying SSH tunnel connection",
            host_name=host_name,
            host_url=host_url,
            host_id=host_id,
            image_prefix=image_prefix,
        )
        logger.info(
            f"[RemoteDockerRunner] Initialized for {host_name} ({host_url})"
        )

        # Discover existing containers on the remote host
        self._register_existing_containers()

    @property
    def client(self) -> docker.DockerClient:
        """
        Get the current Docker client from DockerHostMonitor.

        Returns:
            DockerClient from the monitor

        Raises:
            RuntimeError: If no client available
        """
        client = self._get_client()
        if not client:
            raise RuntimeError(f"No client available for {self.host_name}")
        return client

    def _request_reconnect(self) -> docker.DockerClient:
        """
        Request reconnection from DockerHostMonitor.

        Called when an operation fails with ChannelException.

        Returns:
            New DockerClient after reconnection

        Raises:
            RuntimeError: If reconnection fails
        """
        logger.debug(
            "SSH tunnel reconnect requested",
            host_name=self.host_name,
            host_url=self.host_url,
        )
        logger.warning(f"[RemoteDockerRunner] Requesting reconnect for {self.host_name}")
        client = self._reconnect()
        if not client:
            logger.debug(
                "SSH tunnel reconnect failed - no client returned",
                host_name=self.host_name,
            )
            raise RuntimeError(f"Reconnection failed for {self.host_name}")
        return client

    def _register_existing_containers(self) -> None:
        """
        Discover running audiobook containers on remote host and register them.

        This prevents container name conflicts when the backend restarts while
        Docker containers from a previous run are still alive on the remote host.
        """
        try:
            containers = self.client.containers.list(filters={'name': 'audiobook-'})

            for container in containers:
                if container.status != 'running':
                    continue

                # Extract port from container
                ports = container.attrs.get('NetworkSettings', {}).get('Ports', {})

                for port_key, bindings in ports.items():
                    if bindings and '/tcp' in port_key:
                        host_port = int(bindings[0]['HostPort'])

                        # Reconstruct variant_id from container name
                        # audiobook-debug-stt -> debug-stt:{host_id}
                        # where host_id is e.g. "docker:9de4c37e"
                        base_name = container.name.replace('audiobook-', '')
                        variant_id = f"{base_name}:{self.host_id}"

                        self.containers[variant_id] = container.id

                        host_ip = self._get_host_ip()
                        self.endpoints[variant_id] = EngineEndpoint(
                            base_url=f"http://{host_ip}:{host_port}",
                            container_id=container.id
                        )

                        logger.info(
                            f"[RemoteDockerRunner] Discovered running container on {self.host_name}: "
                            f"{container.name} -> {variant_id} (port {host_port})"
                        )
                        break  # Only one port per container

        except Exception as e:
            logger.warning(f"[RemoteDockerRunner] Failed to discover existing containers on {self.host_name}: {e}")

    def _get_host_ip(self) -> str:
        """
        Extract IP/hostname from SSH URL.

        Returns:
            Hostname portion of SSH URL
        """
        parsed = urlparse(self.host_url)
        hostname = parsed.hostname or 'localhost'
        logger.debug(
            "Resolved network endpoint from SSH URL",
            host_url=self.host_url,
            resolved_hostname=hostname,
        )
        return hostname

    async def _pull_image_with_timeout(self, image: str, variant_id: str = "") -> None:
        """
        Pull Docker image with inactivity timeout and progress reporting.

        Pre-fetches layer sizes from manifest for accurate progress.
        Uses streaming pull to detect stalls. If no progress is received
        for PULL_INACTIVITY_TIMEOUT seconds, the pull is aborted.

        Args:
            image: Full image name with tag (e.g., "ghcr.io/org/engine:latest")
            variant_id: Variant identifier for SSE events (e.g., "xtts:docker:remote")

        Raises:
            RuntimeError: If pull stalls or fails
        """
        from services.event_broadcaster import emit_docker_image_progress
        from services.docker_service import get_manifest_layer_sizes

        # Pre-fetch layer sizes from manifest
        # Parse image name and tag
        if ":" in image:
            image_name, tag = image.rsplit(":", 1)
        else:
            image_name, tag = image, "latest"

        # Extract image path (remove ghcr.io/ prefix if present)
        image_path = image_name
        if image_path.startswith("ghcr.io/"):
            image_path = image_path[8:]

        manifest_layer_sizes = get_manifest_layer_sizes(image_path, tag)
        total_manifest_size = sum(manifest_layer_sizes.values()) if manifest_layer_sizes else 0

        if manifest_layer_sizes:
            logger.debug(
                f"[RemoteDockerRunner] Pre-fetched manifest: {len(manifest_layer_sizes)} layers, "
                f"{total_manifest_size / 1024 / 1024:.1f} MB"
            )

        # Track layer progress: layer_id -> {current: bytes, complete: bool}
        layer_progress: Dict[str, Dict[str, Union[int, bool]]] = {}
        last_reported_percent = -1

        def calculate_overall_progress() -> int:
            """Calculate progress using pre-fetched manifest sizes."""
            if not layer_progress:
                return 0

            if manifest_layer_sizes and total_manifest_size > 0:
                # Manifest-based calculation (accurate)
                downloaded = 0
                for layer_id, info in layer_progress.items():
                    if info.get("complete"):
                        downloaded += manifest_layer_sizes.get(layer_id, info.get("current", 0))
                    else:
                        downloaded += info.get("current", 0)
                return min(100, int((downloaded / total_manifest_size) * 100))
            else:
                # Fallback: layer count based
                total = len(layer_progress)
                completed = sum(1 for info in layer_progress.values() if info.get("complete"))
                return int((completed / total) * 100) if total > 0 else 0

        def pull_with_stream():
            """Generator that yields pull events."""
            for event in self.client.api.pull(image, stream=True, decode=True):
                yield event

        def get_next_event(gen):
            """Get next event from generator, returns None when exhausted."""
            try:
                return next(gen)
            except StopIteration:
                return None

        pull_gen = pull_with_stream()

        while True:
            try:
                event = await asyncio.wait_for(
                    asyncio.to_thread(get_next_event, pull_gen),
                    timeout=PULL_INACTIVITY_TIMEOUT
                )
                if event is None:
                    # Pull completed - emit 100%
                    if variant_id:
                        await emit_docker_image_progress(
                            variant_id=variant_id,
                            status="extracting",
                            progress_percent=100,
                            message="Pull complete"
                        )
                    break

                # Extract progress info from event
                status = event.get("status", "")
                layer_id = event.get("id", "")
                progress_detail = event.get("progressDetail", {})

                # Update layer progress
                if layer_id:
                    if layer_id not in layer_progress:
                        layer_progress[layer_id] = {"current": 0, "complete": False}

                    if progress_detail:
                        layer_progress[layer_id]["current"] = progress_detail.get("current", 0)

                    if status in ("Pull complete", "Already exists", "Download complete"):
                        layer_progress[layer_id]["complete"] = True
                        if layer_id in (manifest_layer_sizes or {}):
                            layer_progress[layer_id]["current"] = manifest_layer_sizes[layer_id]

                # Calculate and emit progress (only forward)
                current_percent = calculate_overall_progress()
                if (variant_id and
                        current_percent >= last_reported_percent + PULL_PROGRESS_MIN_CHANGE):
                    last_reported_percent = current_percent

                    # Determine status type
                    if "Downloading" in status:
                        pull_status = "downloading"
                    elif "Extracting" in status:
                        pull_status = "extracting"
                    else:
                        pull_status = "pulling"

                    await emit_docker_image_progress(
                        variant_id=variant_id,
                        status=pull_status,
                        progress_percent=current_percent,
                        current_layer=layer_id,
                        message=f"{status} {event.get('progress', '')}"
                    )
                    logger.debug(
                        f"[RemoteDockerRunner] Pull on {self.host_name} {current_percent}%: {status}"
                    )

            except asyncio.TimeoutError:
                raise RuntimeError(
                    f"Image pull stalled on {self.host_name} - "
                    f"no progress for {PULL_INACTIVITY_TIMEOUT}s"
                )

    async def start(
        self,
        variant_id: str,
        engine_type: str,
        config: dict
    ) -> EngineEndpoint:
        """
        Start engine container on remote host.

        Includes retry logic for SSH channel failures - on ChannelException,
        requests reconnect from DockerHostMonitor and retries once.

        Args:
            variant_id: Variant identifier (e.g., "xtts:docker:remote")
            engine_type: Engine category (e.g., "tts")
            config: Configuration dict with:
                - port: HTTP port
                - image_tag: Docker image tag (default: "latest")
                - gpu: Whether to enable GPU (default: False)
                - models_volume: Host path for models volume

        Returns:
            EngineEndpoint with remote host URL
        """
        from paramiko.ssh_exception import ChannelException

        # Extract base engine name for container naming
        base_engine_name, _ = _parse_variant_id(variant_id)

        port = config.get('port', 8766)
        image_tag = config.get('image_tag', 'latest')
        gpu = config.get('gpu', False)
        models_volume = config.get('models_volume')

        image = f"{self.image_prefix}/{base_engine_name}:{image_tag}"

        logger.debug(
            f"[RemoteDockerRunner] start variant_id={variant_id} host={self.host_name} "
            f"port={port} gpu={gpu} image={image}"
        )
        logger.info(f"[RemoteDockerRunner] Starting {variant_id} on {self.host_name} (image: {image})")

        # Retry loop for SSH channel failures
        for attempt in range(2):
            try:
                logger.debug(
                    "Starting container via SSH tunnel",
                    attempt=attempt + 1,
                    variant_id=variant_id,
                    host_name=self.host_name,
                    image=image,
                    port=port,
                    gpu=gpu,
                )
                return await self._start_container(
                    variant_id=variant_id,
                    base_engine_name=base_engine_name,
                    image=image,
                    port=port,
                    gpu=gpu,
                    models_volume=models_volume,
                )
            except ChannelException as e:
                logger.debug(
                    "SSH ChannelException during container start",
                    attempt=attempt + 1,
                    error=str(e),
                    variant_id=variant_id,
                )
                if attempt == 0:
                    logger.warning(
                        "[RemoteDockerRunner] SSH channel failed on start, "
                        "requesting reconnect..."
                    )
                    self._request_reconnect()
                else:
                    raise RuntimeError(
                        f"Failed to start {variant_id} after reconnect: {e}"
                    )

        # Should not reach here, but satisfy type checker
        raise RuntimeError(f"Failed to start {variant_id}")

    async def _start_container(
        self,
        variant_id: str,
        base_engine_name: str,
        image: str,
        port: int,
        gpu: bool,
        models_volume: Optional[str],
    ) -> EngineEndpoint:
        """
        Internal method to start container - can be retried on ChannelException.

        Args:
            variant_id: Full variant identifier
            base_engine_name: Base engine name for container naming
            image: Full Docker image name with tag
            port: HTTP port
            gpu: Whether to enable GPU
            models_volume: Host path for models volume

        Returns:
            EngineEndpoint with remote host URL
        """
        # Pull image if not exists
        try:
            self.client.images.get(image)
            logger.debug(
                "Image already exists on remote host",
                image=image,
                host_name=self.host_name,
            )
        except docker.errors.ImageNotFound:
            logger.debug(
                "Image not found on remote, initiating pull",
                image=image,
                host_name=self.host_name,
            )
            logger.info(f"[RemoteDockerRunner] Pulling image {image} on {self.host_name}...")
            try:
                await self._pull_image_with_timeout(image, variant_id)
            except (docker.errors.APIError, RuntimeError) as e:
                raise RuntimeError(f"Failed to pull image {image}: {e}")

        # Configure GPU if requested
        device_requests = []
        if gpu:
            device_requests = [DeviceRequest(count=-1, capabilities=[['gpu']])]
            logger.debug("GPU device request configured for container")

        # Configure volumes
        # - external_models: For custom/user models (baked-in defaults stay in /app/models)
        volumes = {}
        if models_volume:
            volumes[models_volume] = {'bind': '/app/external_models', 'mode': 'rw'}
            logger.debug(
                "Volume mount configured",
                host_path=models_volume,
                container_path="/app/external_models",
            )

        # Build environment variables for container
        # Pass through LOG_LEVEL from backend to container for consistent logging
        container_env = {
            'PORT': str(port),
            'LOG_LEVEL': os.environ.get('LOG_LEVEL', 'INFO')
        }

        # Check for existing container with same name
        container_name = f"audiobook-{base_engine_name}"
        logger.debug(
            "Checking for existing container on remote",
            container_name=container_name,
            host_name=self.host_name,
        )
        try:
            existing_container = self.client.containers.get(container_name)
            if existing_container.status == 'running':
                # Container is already running - check if it's on the expected port
                container_ports = existing_container.attrs.get('NetworkSettings', {}).get('Ports', {})
                expected_port_key = f'{port}/tcp'
                if expected_port_key in container_ports and container_ports[expected_port_key]:
                    # Container is running on the expected port - reuse it
                    logger.info(
                        f"[RemoteDockerRunner] Container {container_name} already running "
                        f"on {self.host_name}:{port}, reusing"
                    )
                    self.containers[variant_id] = existing_container.id
                    host_ip = self._get_host_ip()
                    endpoint = EngineEndpoint(
                        base_url=f"http://{host_ip}:{port}",
                        container_id=existing_container.id
                    )
                    self.endpoints[variant_id] = endpoint
                    return endpoint
                else:
                    # Running but on different port - need to recreate
                    logger.info(
                        f"[RemoteDockerRunner] Container {container_name} on {self.host_name} "
                        "running on wrong port, recreating"
                    )
                    existing_container.remove(force=True)
            else:
                # Container exists but not running - remove it
                logger.info(f"[RemoteDockerRunner] Removing stopped container {container_name} on {self.host_name}")
                existing_container.remove(force=True)
        except docker.errors.NotFound:
            pass

        # Start container (name uses base_engine_name)
        logger.debug(
            "Creating new container on remote",
            container_name=container_name,
            image=image,
            port=port,
            environment=container_env,
            host_name=self.host_name,
        )
        container = self.client.containers.run(
            image,
            detach=True,
            ports={f'{port}/tcp': port},
            volumes=volumes,
            device_requests=device_requests if device_requests else None,
            environment=container_env,
            name=container_name,
            remove=True
        )

        self.containers[variant_id] = container.id
        logger.debug(
            "Container created successfully",
            container_id=container.id,
            container_name=container_name,
            variant_id=variant_id,
        )

        # Create endpoint pointing to remote host
        host_ip = self._get_host_ip()
        endpoint = EngineEndpoint(
            base_url=f"http://{host_ip}:{port}",
            container_id=container.id
        )
        self.endpoints[variant_id] = endpoint
        logger.debug(
            "Endpoint configured for remote container",
            base_url=endpoint.base_url,
            container_id=container.id,
            variant_id=variant_id,
        )

        logger.info(f"[RemoteDockerRunner] {variant_id} started on {self.host_name} (URL: {endpoint.base_url})")

        return endpoint

    async def stop(self, variant_id: str) -> None:
        """Stop engine container on remote host."""
        if variant_id not in self.containers:
            logger.debug(f"[RemoteDockerRunner] {variant_id} not running on {self.host_name}")
            return

        container_id = self.containers[variant_id]
        logger.debug(f"[RemoteDockerRunner] Stopping {variant_id} on {self.host_name}...")

        # Try with retry on ChannelException
        from paramiko.ssh_exception import ChannelException
        for attempt in range(2):
            try:
                logger.debug(
                    "Stopping container via SSH tunnel",
                    attempt=attempt + 1,
                    variant_id=variant_id,
                    container_id=container_id,
                    host_name=self.host_name,
                )
                container = self.client.containers.get(container_id)
                container.stop(timeout=10)
                logger.info(f"[RemoteDockerRunner] {variant_id} stopped on {self.host_name}")
                break
            except docker.errors.NotFound:
                logger.debug(f"[RemoteDockerRunner] {variant_id} container already removed")
                break
            except ChannelException as e:
                logger.debug(
                    "SSH ChannelException during container stop",
                    attempt=attempt + 1,
                    error=str(e),
                    variant_id=variant_id,
                )
                if attempt == 0:
                    logger.warning("[RemoteDockerRunner] SSH channel failed, requesting reconnect...")
                    self._request_reconnect()
                else:
                    raise

        del self.containers[variant_id]
        self.endpoints.pop(variant_id, None)

    def is_running(self, variant_id: str) -> bool:
        """Check if engine container is running on remote host."""
        if variant_id not in self.containers:
            logger.debug(
                "is_running check - variant not tracked",
                variant_id=variant_id,
                host_name=self.host_name,
            )
            return False

        try:
            container = self.client.containers.get(self.containers[variant_id])
            is_running = container.status == 'running'
            logger.debug(
                "is_running check - container status queried",
                variant_id=variant_id,
                container_id=self.containers[variant_id],
                status=container.status,
                is_running=is_running,
            )
            return is_running
        except docker.errors.NotFound:
            logger.debug(
                "is_running check - container not found, cleaning up",
                variant_id=variant_id,
                container_id=self.containers[variant_id],
            )
            del self.containers[variant_id]
            self.endpoints.pop(variant_id, None)
            return False

    def get_endpoint(self, variant_id: str) -> Optional[EngineEndpoint]:
        """Get endpoint for running container."""
        return self.endpoints.get(variant_id)
