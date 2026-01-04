"""
DockerRunner - Local Docker container execution

Runs engines as Docker containers on the local Docker daemon.
Supports GPU passthrough via NVIDIA Container Toolkit.
"""

import asyncio
import os
from typing import Dict, Optional

import docker
from docker.types import DeviceRequest
from loguru import logger

from core.engine_runner import EngineRunner, EngineEndpoint

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
        'xtts:docker:local' -> ('xtts', 'docker:local')
        'xtts:local' -> ('xtts', 'local')
    """
    parts = variant_id.split(':', 1)
    if len(parts) == 1:
        return parts[0], 'local'
    return parts[0], parts[1]


class DockerRunner(EngineRunner):
    """
    Runs engines as Docker containers on local Docker daemon.

    Features:
    - Automatic image pulling from registry
    - GPU support via NVIDIA Container Toolkit
    - Volume mounting for models
    - Container lifecycle management

    Attributes:
        client: Docker SDK client
        containers: Active container IDs by variant_id
        endpoints: EngineEndpoint instances for running containers by variant_id
        engine_host: Hostname to reach engine containers (configurable for Docker-in-Docker)
    """

    def __init__(self, image_prefix: str = "audiobook-maker", docker_url: Optional[str] = None):
        """
        Initialize DockerRunner.

        Args:
            image_prefix: Docker image name prefix (e.g., "audiobook-maker" for local,
                         "ghcr.io/audiobook-maker" for registry)
            docker_url: Docker daemon URL (None = use default from environment)
        """
        try:
            if docker_url:
                self.client = docker.DockerClient(base_url=docker_url)
            else:
                self.client = docker.from_env()
            self.client.ping()
            logger.info("[DockerRunner] Connected to Docker daemon")
        except docker.errors.DockerException as e:
            logger.error(f"[DockerRunner] Failed to connect to Docker: {e}")
            raise RuntimeError(f"Docker not available: {e}")

        self.image_prefix = image_prefix
        self.containers: Dict[str, str] = {}  # variant_id -> container_id
        self.endpoints: Dict[str, EngineEndpoint] = {}  # variant_id -> endpoint

        # Host to reach engine containers from this process
        # - "127.0.0.1" when running directly on host
        # - "host.docker.internal" when running inside a container (Docker-in-Docker pattern)
        self.engine_host = os.getenv("DOCKER_ENGINE_HOST", "127.0.0.1")
        if self.engine_host != "127.0.0.1":
            logger.info(f"[DockerRunner] Using engine host: {self.engine_host}")

        # Discover existing audiobook containers and register their ports
        self._register_existing_containers()

    async def _pull_image_with_timeout(self, image: str, variant_id: str = "") -> None:
        """
        Pull Docker image with inactivity timeout and progress reporting.

        Uses streaming pull to detect stalls. If no progress is received
        for PULL_INACTIVITY_TIMEOUT seconds, the pull is aborted.
        Emits SSE progress events for frontend display.

        Args:
            image: Full image name with tag (e.g., "ghcr.io/org/engine:latest")
            variant_id: Variant identifier for SSE events (e.g., "xtts:docker:local")

        Raises:
            RuntimeError: If pull stalls or fails
        """
        from services.event_broadcaster import emit_docker_image_progress

        # Track layer progress for aggregation
        layer_progress: Dict[str, Dict[str, int]] = {}  # layer_id -> {current, total}
        last_reported_percent = -1
        logger.debug("Starting image pull with progress tracking", image=image, variant_id=variant_id, timeout_seconds=PULL_INACTIVITY_TIMEOUT)

        def calculate_overall_progress() -> int:
            """Calculate overall progress from all layers (0-100)."""
            if not layer_progress:
                return 0
            total_bytes = sum(lp.get("total", 0) for lp in layer_progress.values())
            current_bytes = sum(lp.get("current", 0) for lp in layer_progress.values())
            if total_bytes == 0:
                return 0
            return min(100, int((current_bytes / total_bytes) * 100))

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

                # Update layer progress if we have size info
                if layer_id and progress_detail:
                    current = progress_detail.get("current", 0)
                    total = progress_detail.get("total", 0)
                    if total > 0:
                        was_new = layer_id not in layer_progress
                        layer_progress[layer_id] = {"current": current, "total": total}
                        if was_new:
                            logger.debug("Layer progress tracking started", layer_id=layer_id, total_bytes=total, layer_count=len(layer_progress))

                # Calculate and emit progress if changed significantly
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
                    logger.debug(f"[DockerRunner] Pull {current_percent}%: {status}")

            except asyncio.TimeoutError:
                total_bytes = sum(lp.get("total", 0) for lp in layer_progress.values())
                current_bytes = sum(lp.get("current", 0) for lp in layer_progress.values())
                logger.debug(
                    "Pull timeout triggered - no progress received",
                    timeout_seconds=PULL_INACTIVITY_TIMEOUT,
                    layers_tracked=len(layer_progress),
                    current_bytes=current_bytes,
                    total_bytes=total_bytes,
                    last_percent=last_reported_percent
                )
                raise RuntimeError(
                    f"Image pull stalled - no progress for {PULL_INACTIVITY_TIMEOUT}s"
                )

    def _register_existing_containers(self) -> None:
        """
        Discover running audiobook containers and register their ports.

        This prevents port collisions when the backend restarts while
        Docker containers from a previous run are still alive.
        """
        try:
            containers = self.client.containers.list(filters={'name': 'audiobook-'})
            logger.debug("Scanning for existing audiobook containers", container_count=len(containers))
            for container in containers:
                if container.status != 'running':
                    continue

                # Extract port from container
                ports = container.attrs.get('NetworkSettings', {}).get('Ports', {})
                for port_key, bindings in ports.items():
                    if bindings and '/tcp' in port_key:
                        host_port = int(bindings[0]['HostPort'])

                        # Register port in global registry
                        from core.base_engine_manager import _global_used_ports
                        _global_used_ports.add(host_port)

                        # Reconstruct variant_id from container name
                        # audiobook-debug-tts -> debug-tts:docker:local
                        base_name = container.name.replace('audiobook-', '')
                        variant_id = f"{base_name}:docker:local"

                        self.containers[variant_id] = container.id
                        self.endpoints[variant_id] = EngineEndpoint(
                            base_url=f"http://{self.engine_host}:{host_port}",
                            container_id=container.id
                        )

                        logger.info(f"[DockerRunner] Discovered running container: {container.name} on port {host_port}")
                        logger.debug(
                            "Container registered from discovery",
                            container_name=container.name,
                            container_id=container.short_id,
                            variant_id=variant_id,
                            host_port=host_port,
                            endpoint_url=f"http://{self.engine_host}:{host_port}"
                        )
                        break  # Only one port per container

            # Log discovery summary
            if self.containers:
                logger.debug("Container discovery complete", registered_count=len(self.containers), variants=list(self.containers.keys()))
            else:
                logger.debug("Container discovery complete - no running containers found")

        except Exception as e:
            logger.warning(f"[DockerRunner] Failed to discover existing containers: {e}")

    async def start(
        self,
        variant_id: str,
        engine_type: str,
        config: dict
    ) -> EngineEndpoint:
        """
        Start engine container.

        Args:
            variant_id: Variant identifier (e.g., "xtts:docker:local")
            engine_type: Engine category (e.g., "tts")
            config: Configuration dict with:
                - port: HTTP port
                - image_tag: Docker image tag (default: "latest")
                - gpu: Whether to enable GPU (default: False)
                - docker_volumes: Dict with configurable volume paths:
                    - samples: Host path for samples (mounted to /app/samples), or null
                    - models: Host path base for models (mounted to /app/external_models), or null

        Returns:
            EngineEndpoint with localhost URL
        """
        # Extract base engine name for container naming and paths
        base_engine_name, _ = _parse_variant_id(variant_id)

        port = config.get('port')
        image_tag = config.get('image_tag', 'latest')
        gpu = config.get('gpu', False)
        docker_volumes = config.get('docker_volumes', {})

        # Get image name from config (full name from DB) or construct from prefix
        docker_image = config.get('docker_image')
        if docker_image:
            # Use full image name from DB (e.g., ghcr.io/digijoe79/audiobook-maker-engines/debug-tts)
            image = f"{docker_image}:{image_tag}"
        else:
            # Fallback: construct from prefix (for local builds)
            image = f"{self.image_prefix}/{base_engine_name}:{image_tag}"

        logger.debug(
            f"[DockerRunner] start variant_id={variant_id} port={port} gpu={gpu} image={image}"
        )
        logger.info(f"[DockerRunner] Starting {variant_id} container (image: {image}, port: {port})")

        # Check if image exists locally
        try:
            self.client.images.get(image)
            logger.debug(f"[DockerRunner] Image {image} found locally")
        except docker.errors.ImageNotFound:
            logger.info(f"[DockerRunner] Pulling image {image}...")
            try:
                await self._pull_image_with_timeout(image, variant_id)
            except (docker.errors.APIError, RuntimeError) as e:
                raise RuntimeError(f"Failed to pull image {image}: {e}")

        # Configure GPU if requested
        device_requests = []
        if gpu:
            device_requests = [DeviceRequest(count=-1, capabilities=[['gpu']])]
            logger.info(f"[DockerRunner] GPU enabled for {variant_id}")

        # Configure volumes from docker_volumes config
        # - samples: Shared path for speaker samples across all engines -> /app/samples
        # - models: Per-engine path for model files -> /app/external_models
        # null values mean "no mount, use upload mechanism for samples"
        volumes = {}

        samples_path = docker_volumes.get('samples')
        if samples_path:
            # Convert Windows paths (E:\path) to Docker format (/e/path)
            if len(samples_path) > 1 and samples_path[1] == ':':
                drive = samples_path[0].lower()
                samples_path = f"/{drive}{samples_path[2:].replace(chr(92), '/')}"
            volumes[samples_path] = {'bind': '/app/samples', 'mode': 'rw'}
            logger.debug(f"[DockerRunner] Mounting samples: {samples_path} -> /app/samples")

        models_path = docker_volumes.get('models')
        if models_path:
            # Append base_engine_name for isolation: /data/models/xtts -> /app/external_models
            host_models_path = f"{models_path}/{base_engine_name}"
            # Convert Windows paths (E:\path) to Docker format (/e/path)
            # Docker on Windows via API needs this format to avoid : conflicts
            if len(host_models_path) > 1 and host_models_path[1] == ':':
                drive = host_models_path[0].lower()
                host_models_path = f"/{drive}{host_models_path[2:].replace(chr(92), '/')}"
            volumes[host_models_path] = {'bind': '/app/external_models', 'mode': 'rw'}
            logger.debug(f"[DockerRunner] Mounting models: {host_models_path} -> /app/external_models")

        # Check for existing container with same name
        # Container name uses base_engine_name (only one container per base engine)
        container_name = f"audiobook-{base_engine_name}"
        try:
            existing_container = self.client.containers.get(container_name)
            if existing_container.status == 'running':
                # Container is already running - check if it's on the expected port
                container_ports = existing_container.attrs.get('NetworkSettings', {}).get('Ports', {})
                expected_port_key = f'{port}/tcp'
                if expected_port_key in container_ports and container_ports[expected_port_key]:
                    # Container is running on the expected port - reuse it
                    logger.info(f"[DockerRunner] Container {container_name} already running on port {port}, reusing")
                    self.containers[variant_id] = existing_container.id
                    endpoint = EngineEndpoint(
                        base_url=f"http://{self.engine_host}:{port}",
                        container_id=existing_container.id
                    )
                    self.endpoints[variant_id] = endpoint
                    return endpoint
                else:
                    # Running but on different port - need to recreate
                    logger.info(f"[DockerRunner] Container {container_name} running on wrong port, recreating")
                    existing_container.remove(force=True)
            else:
                # Container exists but not running - remove it
                logger.info(f"[DockerRunner] Removing stopped container {container_name}")
                existing_container.remove(force=True)
        except docker.errors.NotFound:
            pass

        # Check if requested port is used by another audiobook container
        for container in self.client.containers.list(filters={'name': 'audiobook-'}):
            if container.name == container_name:
                continue  # Skip our own container (already handled above)
            container_ports = container.attrs.get('NetworkSettings', {}).get('Ports', {})
            port_key = f'{port}/tcp'
            if port_key in container_ports and container_ports[port_key]:
                # Another container is using our port
                other_engine = container.name.replace('audiobook-', '')
                raise RuntimeError(
                    f"Port {port} is already used by container '{container.name}' ({other_engine}). "
                    f"Stop that engine first or use a different port."
                )

        # Build environment variables for container
        # Pass through LOG_LEVEL from backend to container for consistent logging
        container_env = {
            'PORT': str(port),
            'LOG_LEVEL': os.environ.get('LOG_LEVEL', 'INFO')
        }

        # Start container
        logger.debug(
            "Creating container",
            container_name=container_name,
            image=image,
            port_mapping=f"{port}/tcp -> {port}",
            volume_count=len(volumes),
            gpu_enabled=bool(device_requests),
            env_vars=list(container_env.keys())
        )

        container = self.client.containers.run(
            image,
            detach=True,
            ports={f'{port}/tcp': port},
            volumes=volumes if volumes else None,
            device_requests=device_requests if device_requests else None,
            environment=container_env,
            name=container_name,
            remove=True  # Auto-cleanup after stop
        )

        self.containers[variant_id] = container.id

        # Create endpoint
        endpoint = EngineEndpoint(
            base_url=f"http://{self.engine_host}:{port}",
            container_id=container.id
        )
        self.endpoints[variant_id] = endpoint

        logger.info(f"[DockerRunner] {variant_id} container started (ID: {container.short_id})")
        logger.debug(
            "Container started successfully",
            variant_id=variant_id,
            container_id=container.id,
            short_id=container.short_id,
            assigned_port=port,
            endpoint_url=endpoint.base_url
        )

        return endpoint

    async def stop(self, variant_id: str) -> None:
        """
        Stop engine container.

        Args:
            variant_id: Variant to stop (e.g., "xtts:docker:local")
        """
        if variant_id not in self.containers:
            logger.debug(f"[DockerRunner] {variant_id} not running, nothing to stop")
            return

        container_id = self.containers[variant_id]

        logger.debug(f"[DockerRunner] Stopping {variant_id} container...")

        try:
            container = self.client.containers.get(container_id)
            container.stop(timeout=10)
            logger.info(f"[DockerRunner] {variant_id} container stopped")
        except docker.errors.NotFound:
            logger.debug(f"[DockerRunner] {variant_id} container already removed")

        # Cleanup
        del self.containers[variant_id]
        self.endpoints.pop(variant_id, None)

    def is_running(self, variant_id: str) -> bool:
        """Check if engine container is running."""
        if variant_id not in self.containers:
            return False

        try:
            container = self.client.containers.get(self.containers[variant_id])
            return container.status == 'running'
        except docker.errors.NotFound:
            # Container was removed - cleanup
            del self.containers[variant_id]
            self.endpoints.pop(variant_id, None)
            return False

    def get_endpoint(self, variant_id: str) -> Optional[EngineEndpoint]:
        """Get endpoint for running container."""
        return self.endpoints.get(variant_id)

    def list_containers(self) -> Dict[str, dict]:
        """
        List all audiobook-maker containers.

        Returns:
            Dictionary of container_name -> status info
        """
        containers = self.client.containers.list(
            all=True,
            filters={'name': 'audiobook-'}
        )

        result = {}
        for container in containers:
            result[container.name] = {
                'id': container.short_id,
                'status': container.status,
                'image': container.image.tags[0] if container.image.tags else 'unknown'
            }

        return result
