"""
Docker Service - Manage Docker images and containers

Provides functions for pulling, removing, and inspecting Docker images.
Supports cancellable pulls with SSE progress events.
"""

import asyncio
import docker
import requests
import threading
from docker.errors import DockerException, ImageNotFound, APIError
from typing import Optional, Dict, Any, Union
from loguru import logger


class PullCancelledException(Exception):
    """Raised when a Docker pull is cancelled by user."""
    pass


# Active pulls registry: variant_id -> cancel_event
# When event is set, the pull should be cancelled
_active_pulls: Dict[str, threading.Event] = {}
_pulls_lock = threading.Lock()


def register_pull(variant_id: str) -> None:
    """Register a new pull operation for cancellation tracking."""
    with _pulls_lock:
        _active_pulls[variant_id] = threading.Event()
        logger.debug(f"Registered pull for {variant_id}")


def cancel_pull(variant_id: str) -> bool:
    """
    Request cancellation of an active pull.

    Returns:
        True if pull was found and cancellation requested,
        False if no active pull exists for variant_id
    """
    with _pulls_lock:
        if variant_id in _active_pulls:
            _active_pulls[variant_id].set()
            logger.info(f"Cancellation requested for {variant_id}")
            return True
        return False


def is_pull_cancelled(variant_id: str) -> bool:
    """Check if pull cancellation was requested."""
    with _pulls_lock:
        event = _active_pulls.get(variant_id)
        return event.is_set() if event else False


def unregister_pull(variant_id: str) -> None:
    """Remove pull from active pulls registry."""
    with _pulls_lock:
        _active_pulls.pop(variant_id, None)
        logger.debug(f"Unregistered pull for {variant_id}")


def get_docker_client(host_id: Optional[str] = None) -> docker.DockerClient:
    """
    Get Docker client for local or remote host.

    Args:
        host_id: None or 'docker:local' for local Docker,
                 or remote host ID (e.g., 'docker:abc123')

    Returns:
        DockerClient instance

    Raises:
        DockerException: If Docker is not available or host not connected
    """
    # Local Docker
    if host_id is None or host_id == "docker:local":
        try:
            client = docker.from_env()
            client.ping()
            return client
        except DockerException as e:
            logger.error(f"Failed to connect to local Docker: {e}")
            raise

    # Remote Docker - get client from DockerHostMonitor
    from services.docker_host_monitor import docker_host_monitor

    client = docker_host_monitor.get_client(host_id)
    if client is None:
        raise DockerException(f"[DOCKER_HOST_NOT_CONNECTED]hostId:{host_id}")

    return client


def pull_image(
    image_name: str,
    tag: str = "latest",
    progress_callback: Optional[callable] = None,
    host_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Pull a Docker image from registry.

    Args:
        image_name: Full image name (e.g., 'ghcr.io/digijoe79/audiobook-maker-engines/debug-tts')
        tag: Image tag (default: 'latest')
        progress_callback: Optional callback for progress updates (layer_id, status, progress)
        host_id: Docker host ID (None for local, or remote host ID)

    Returns:
        Dict with pull result: {success, image_id, size, message}

    Raises:
        DockerException: If pull fails
    """
    full_image = f"{image_name}:{tag}"
    logger.info(f"Pulling Docker image: {full_image} (host: {host_id or 'local'})")

    try:
        client = get_docker_client(host_id)

        # Pull with progress streaming
        pull_log = []
        for line in client.api.pull(image_name, tag=tag, stream=True, decode=True):
            pull_log.append(line)

            # Extract progress info
            status = line.get("status", "")
            layer_id = line.get("id", "")
            progress = line.get("progress", "")

            if progress_callback and layer_id:
                progress_callback(layer_id, status, progress)

            # Log significant events
            if status in ("Pulling from", "Pull complete", "Already exists", "Downloaded newer image"):
                logger.debug(f"Pull: {status} {layer_id}")

        # Get the pulled image info
        image = client.images.get(full_image)
        size_mb = image.attrs.get("Size", 0) / (1024 * 1024)

        logger.info(f"Successfully pulled {full_image} ({size_mb:.1f} MB)")

        return {
            "success": True,
            "image_id": image.id,
            "size": image.attrs.get("Size", 0),
            "size_mb": round(size_mb, 1),
            "message": f"Pulled {full_image} ({size_mb:.1f} MB)",
        }

    except ImageNotFound as e:
        logger.error(f"Image not found: {full_image}")
        raise DockerException(f"[DOCKER_IMAGE_NOT_FOUND]image:{full_image}") from e
    except APIError as e:
        logger.error(f"Docker API error pulling {full_image}: {e}")
        raise DockerException(f"[DOCKER_PULL_FAILED]image:{full_image};error:{e}") from e


async def pull_image_with_progress(
    image_name: str,
    tag: str = "latest",
    variant_id: str = "",
    host_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Pull a Docker image with SSE progress events.

    Pre-fetches layer sizes from the registry manifest for accurate progress
    calculation. Progress never jumps backwards because total size is known
    upfront.

    Args:
        image_name: Full image name (e.g., 'ghcr.io/digijoe79/audiobook-maker-engines/debug-tts')
        tag: Image tag (default: 'latest')
        variant_id: Variant identifier for SSE events (e.g., 'debug-tts:docker:local')
        host_id: Docker host ID (None for local, or remote host ID)

    Returns:
        Dict with pull result: {success, image_id, size, message}

    Raises:
        DockerException: If pull fails
    """
    from services.event_broadcaster import emit_docker_image_progress

    full_image = f"{image_name}:{tag}"
    logger.info(f"Pulling Docker image with progress: {full_image} (host: {host_id or 'local'})")

    # Get the event loop NOW (before entering thread pool)
    main_loop = asyncio.get_running_loop()

    # Pre-fetch layer sizes from manifest for accurate progress
    # Extract image path (remove ghcr.io/ prefix if present)
    image_path = image_name
    if image_path.startswith("ghcr.io/"):
        image_path = image_path[8:]  # Remove "ghcr.io/"

    manifest_layer_sizes = get_manifest_layer_sizes(image_path, tag)
    total_manifest_size = sum(manifest_layer_sizes.values()) if manifest_layer_sizes else 0

    if manifest_layer_sizes:
        logger.info(
            f"Pre-fetched manifest: {len(manifest_layer_sizes)} layers, "
            f"{total_manifest_size / 1024 / 1024:.1f} MB total"
        )
    else:
        logger.warning(f"Could not pre-fetch manifest for {image_name}:{tag}, using fallback progress")

    # Track layer progress
    # Key: layer short ID (12 chars), Value: {"current": bytes, "complete": bool}
    layer_progress: Dict[str, Dict[str, Union[int, bool]]] = {}
    last_percent = -1

    def _calculate_overall_progress() -> int:
        """
        Calculate overall progress using pre-fetched manifest sizes.

        If manifest was fetched: progress = downloaded_bytes / total_manifest_size
        Fallback: count completed layers vs total layers seen
        """
        if not layer_progress:
            return 0

        if manifest_layer_sizes and total_manifest_size > 0:
            # Use manifest-based calculation (accurate, never jumps back)
            downloaded = 0
            for layer_id, info in layer_progress.items():
                if info.get("complete"):
                    # Layer complete - use full size from manifest
                    downloaded += manifest_layer_sizes.get(layer_id, info.get("current", 0))
                else:
                    # Layer in progress - use current bytes
                    downloaded += info.get("current", 0)

            return min(100, int((downloaded / total_manifest_size) * 100))
        else:
            # Fallback: layer count based progress
            total_layers = len(layer_progress)
            completed = sum(1 for info in layer_progress.values() if info.get("complete"))
            return int((completed / total_layers) * 100) if total_layers > 0 else 0

    def _sync_pull() -> Dict[str, Any]:
        """Synchronous pull operation to run in thread pool."""
        nonlocal last_percent

        client = get_docker_client(host_id)

        # Pull with progress streaming
        for line in client.api.pull(image_name, tag=tag, stream=True, decode=True):
            # Check for cancellation between Docker events
            if variant_id and is_pull_cancelled(variant_id):
                logger.info(f"Pull cancelled for {variant_id}")
                raise PullCancelledException(f"Pull cancelled: {variant_id}")

            status = line.get("status", "")
            layer_id = line.get("id", "")
            progress_detail = line.get("progressDetail", {})

            # Update layer progress
            if layer_id:
                if layer_id not in layer_progress:
                    layer_progress[layer_id] = {"current": 0, "complete": False}

                # Update current bytes from progress detail
                if progress_detail:
                    current = progress_detail.get("current", 0)
                    layer_progress[layer_id]["current"] = current

                # Mark complete on terminal statuses
                if status in ("Pull complete", "Already exists", "Download complete"):
                    layer_progress[layer_id]["complete"] = True
                    # Set current to full size if we know it from manifest
                    if layer_id in (manifest_layer_sizes or {}):
                        layer_progress[layer_id]["current"] = manifest_layer_sizes[layer_id]

            # Calculate and emit progress (only forward, throttled)
            current_percent = _calculate_overall_progress()

            # Only emit if progress increased by 2% or more (never backwards)
            if current_percent >= last_percent + 2 or (current_percent == 100 and last_percent < 100):
                last_percent = current_percent

                # Determine status type
                if "Downloading" in status:
                    pull_status = "downloading"
                elif "Extracting" in status:
                    pull_status = "extracting"
                else:
                    pull_status = "pulling"

                # Schedule async event emission on the main event loop
                asyncio.run_coroutine_threadsafe(
                    emit_docker_image_progress(
                        variant_id=variant_id,
                        status=pull_status,
                        progress_percent=current_percent,
                        current_layer=layer_id,
                        message=f"{status} {layer_id}" if layer_id else status,
                    ),
                    main_loop
                )

        # Get the pulled image info
        image = client.images.get(full_image)
        size_mb = image.attrs.get("Size", 0) / (1024 / 1024)

        return {
            "success": True,
            "image_id": image.id,
            "size": image.attrs.get("Size", 0),
            "size_mb": round(size_mb, 1),
            "message": f"Pulled {full_image} ({size_mb:.1f} MB)",
        }

    # Register pull for cancellation tracking
    if variant_id:
        register_pull(variant_id)

    try:
        # Emit initial 0% progress
        if variant_id:
            await emit_docker_image_progress(
                variant_id=variant_id,
                status="pulling",
                progress_percent=0,
                message=f"Starting pull: {full_image}",
            )

        # Run the blocking Docker pull in a thread pool
        result = await main_loop.run_in_executor(None, _sync_pull)

        # Emit final 100% progress
        if variant_id:
            await emit_docker_image_progress(
                variant_id=variant_id,
                status="extracting",
                progress_percent=100,
                message="Pull complete",
            )

        logger.info(f"Successfully pulled {full_image}")
        return result

    except PullCancelledException:
        # Re-raise cancellation for caller to handle
        raise
    except ImageNotFound as e:
        logger.error(f"Image not found: {full_image}")
        raise DockerException(f"[DOCKER_IMAGE_NOT_FOUND]image:{full_image}") from e
    except APIError as e:
        logger.error(f"Docker API error pulling {full_image}: {e}")
        raise DockerException(f"[DOCKER_PULL_FAILED]image:{full_image};error:{e}") from e
    finally:
        # Always unregister pull when done
        if variant_id:
            unregister_pull(variant_id)


def get_image_id(image_name: str, tag: str = "latest", host_id: Optional[str] = None) -> Optional[str]:
    """
    Get the Docker image ID for a given image name and tag.

    Args:
        image_name: Full image name
        tag: Image tag
        host_id: Docker host ID (None for local, or remote host ID)

    Returns:
        Image ID (sha256:xxx) or None if not found
    """
    full_image = f"{image_name}:{tag}"

    try:
        client = get_docker_client(host_id)
        image = client.images.get(full_image)
        return image.id
    except ImageNotFound:
        return None
    except DockerException as e:
        logger.warning(f"Error getting image ID for {full_image}: {e}")
        return None


def remove_dangling_image(old_image_id: str, host_id: Optional[str] = None) -> bool:
    """
    Remove a dangling image by ID (after update replaced it).

    Only removes if the image now has no tags (<none>:<none>).
    This prevents accidental removal of images still in use.

    Args:
        old_image_id: The image ID to remove (sha256:xxx)
        host_id: Docker host ID (None for local, or remote host ID)

    Returns:
        True if removed, False if not dangling or removal failed
    """
    if not old_image_id:
        return False

    try:
        client = get_docker_client(host_id)
        image = client.images.get(old_image_id)

        # Only remove if image has no tags (dangling)
        if not image.tags:
            client.images.remove(old_image_id, force=True)
            logger.info(f"Removed dangling image: {old_image_id[:19]}")
            return True
        else:
            logger.debug(f"Image {old_image_id[:19]} still has tags, not removing: {image.tags}")
            return False

    except ImageNotFound:
        # Already removed
        return True
    except APIError as e:
        logger.warning(f"Failed to remove dangling image {old_image_id[:19]}: {e}")
        return False
    except DockerException as e:
        logger.warning(f"Error removing dangling image: {e}")
        return False


def remove_image(image_name: str, tag: str = "latest", force: bool = False, host_id: Optional[str] = None) -> bool:
    """
    Remove a Docker image.

    Args:
        image_name: Full image name
        tag: Image tag
        force: Force removal even if containers are using it
        host_id: Docker host ID (None for local, or remote host ID)

    Returns:
        True if removed successfully
    """
    full_image = f"{image_name}:{tag}"
    logger.info(f"Removing Docker image: {full_image} (host: {host_id or 'local'})")

    try:
        client = get_docker_client(host_id)
        client.images.remove(full_image, force=force)
        logger.info(f"Successfully removed {full_image}")
        return True

    except ImageNotFound:
        logger.warning(f"Image not found for removal: {full_image}")
        return True  # Already gone
    except APIError as e:
        logger.error(f"Failed to remove image {full_image}: {e}")
        raise DockerException(f"[DOCKER_REMOVE_FAILED]image:{full_image};error:{e}") from e


def image_exists(image_name: str, tag: str = "latest", host_id: Optional[str] = None) -> bool:
    """
    Check if a Docker image exists on a host.

    Args:
        image_name: Full image name
        tag: Image tag
        host_id: Docker host ID (None for local, or remote host ID)

    Returns:
        True if image exists on the host
    """
    full_image = f"{image_name}:{tag}"

    try:
        client = get_docker_client(host_id)
        client.images.get(full_image)
        return True
    except ImageNotFound:
        return False
    except DockerException as e:
        logger.warning(f"Error checking image {full_image}: {e}")
        return False


def get_image_info(image_name: str, tag: str = "latest", host_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Get information about a Docker image on a host.

    Args:
        image_name: Full image name
        tag: Image tag
        host_id: Docker host ID (None for local, or remote host ID)

    Returns:
        Dict with image info or None if not found
    """
    full_image = f"{image_name}:{tag}"

    try:
        client = get_docker_client(host_id)
        image = client.images.get(full_image)

        return {
            "id": image.id,
            "short_id": image.short_id,
            "tags": image.tags,
            "size": image.attrs.get("Size", 0),
            "size_mb": round(image.attrs.get("Size", 0) / (1024 * 1024), 1),
            "created": image.attrs.get("Created"),
            "architecture": image.attrs.get("Architecture"),
            "os": image.attrs.get("Os"),
        }

    except ImageNotFound:
        return None
    except DockerException as e:
        logger.warning(f"Error getting image info for {full_image}: {e}")
        return None


def is_docker_available(host_id: Optional[str] = None) -> bool:
    """
    Check if Docker daemon is running and accessible.

    Args:
        host_id: Docker host ID (None for local, or remote host ID)

    Returns:
        True if Docker is available on the host
    """
    try:
        client = get_docker_client(host_id)
        client.ping()
        return True
    except DockerException:
        return False


def cleanup_orphaned_containers(host_id: Optional[str] = None) -> int:
    """
    Stop and remove orphaned audiobook ENGINE containers from previous sessions.

    When the backend starts, any running engine container is orphaned
    (the backend didn't start it in this session). This function cleans them up.

    Note: Only stops engine containers (audiobook-{engine}), NOT the backend
    container (audiobook-maker-backend) or other infrastructure containers.

    Args:
        host_id: Docker host ID (None for local, or remote host ID)

    Returns:
        Number of containers stopped and removed
    """
    if not is_docker_available(host_id):
        return 0

    # Containers to exclude from cleanup (infrastructure, not engines)
    EXCLUDED_CONTAINERS = {
        'audiobook-maker-backend',
        'audiobook-backend',  # Common alternative name
        'audiobook-maker-frontend',
        'audiobook-maker-db',
    }

    try:
        client = get_docker_client(host_id)
        containers = client.containers.list(filters={'name': 'audiobook-'})

        cleanup_count = 0
        for container in containers:
            # Skip infrastructure containers
            if container.name in EXCLUDED_CONTAINERS:
                continue

            # Skip non-running containers
            if container.status != 'running':
                continue

            try:
                container.stop(timeout=10)
                logger.info(f"Stopped orphaned container: {container.name}")
                cleanup_count += 1
            except APIError as e:
                logger.warning(f"Failed to stop orphaned container {container.name}: {e}")

        return cleanup_count

    except DockerException as e:
        logger.warning(f"Failed to cleanup orphaned containers: {e}")
        return 0


def get_remote_digest(image: str, tag: str = "latest") -> Optional[str]:
    """
    Get the digest of an image from GHCR registry without pulling.

    Uses the Registry API v2 to fetch only the manifest digest,
    which is just a few KB of network traffic.

    Args:
        image: Image path without registry prefix (e.g., 'digijoe79/audiobook-maker-engines/xtts')
        tag: Image tag (default: 'latest')

    Returns:
        Digest string (e.g., 'sha256:abc123...') or None if not found
    """
    try:
        # Get anonymous token for public GHCR image
        token_url = f"https://ghcr.io/token?scope=repository:{image}:pull"
        token_resp = requests.get(token_url, timeout=10)
        token_resp.raise_for_status()
        token = token_resp.json().get("token")

        if not token:
            logger.warning(f"Failed to get token for {image}")
            return None

        # HEAD request to get manifest digest (no download)
        manifest_url = f"https://ghcr.io/v2/{image}/manifests/{tag}"
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json"
        }

        resp = requests.head(manifest_url, headers=headers, timeout=10)

        if resp.status_code == 404:
            logger.debug(f"Image not found in registry: {image}:{tag}")
            return None

        resp.raise_for_status()

        digest = resp.headers.get("Docker-Content-Digest")
        logger.debug(f"Remote digest for {image}:{tag}: {digest}")
        return digest

    except requests.RequestException as e:
        logger.warning(f"Failed to get remote digest for {image}:{tag}: {e}")
        return None


def get_manifest_layer_sizes(
    image: str,
    tag: str = "latest",
    platform_arch: str = "amd64",
    platform_os: str = "linux"
) -> Optional[Dict[str, int]]:
    """
    Get layer sizes from GHCR manifest before pulling.

    Fetches the image manifest to get exact layer sizes upfront,
    enabling accurate progress calculation during pull.

    Args:
        image: Image path without registry prefix
               (e.g., 'digijoe79/audiobook-maker-engines/xtts')
        tag: Image tag (default: 'latest')
        platform_arch: Target architecture (default: 'amd64')
        platform_os: Target OS (default: 'linux')

    Returns:
        Dict mapping layer digest to size in bytes, or None on error.
        Example: {'sha256:abc123...': 28400000, 'sha256:def456...': 1230000}
    """
    try:
        # Get anonymous token for public GHCR image
        token_url = f"https://ghcr.io/token?scope=repository:{image}:pull"
        token_resp = requests.get(token_url, timeout=10)
        token_resp.raise_for_status()
        token = token_resp.json().get("token")

        if not token:
            logger.warning(f"Failed to get token for {image}")
            return None

        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": (
                "application/vnd.oci.image.index.v1+json, "
                "application/vnd.docker.distribution.manifest.v2+json, "
                "application/vnd.docker.distribution.manifest.list.v2+json"
            )
        }

        # Get manifest (could be multi-platform index or single manifest)
        manifest_url = f"https://ghcr.io/v2/{image}/manifests/{tag}"
        resp = requests.get(manifest_url, headers=headers, timeout=10)

        if resp.status_code == 404:
            logger.debug(f"Image not found in registry: {image}:{tag}")
            return None

        resp.raise_for_status()
        manifest = resp.json()

        # Check if multi-platform image (OCI index)
        if "manifests" in manifest:
            # Find the matching platform
            target_digest = None
            for m in manifest.get("manifests", []):
                platform = m.get("platform", {})
                if (platform.get("architecture") == platform_arch and
                        platform.get("os") == platform_os):
                    target_digest = m["digest"]
                    break

            if not target_digest:
                logger.warning(
                    f"Platform {platform_os}/{platform_arch} not found for {image}:{tag}"
                )
                return None

            # Fetch the platform-specific manifest
            specific_url = f"https://ghcr.io/v2/{image}/manifests/{target_digest}"
            headers["Accept"] = (
                "application/vnd.oci.image.manifest.v1+json, "
                "application/vnd.docker.distribution.manifest.v2+json"
            )
            specific_resp = requests.get(specific_url, headers=headers, timeout=10)
            specific_resp.raise_for_status()
            manifest = specific_resp.json()

        # Extract layer sizes
        layers = manifest.get("layers", [])
        layer_sizes = {}
        total_size = 0

        for layer in layers:
            digest = layer.get("digest", "")
            size = layer.get("size", 0)
            if digest and size > 0:
                # Use short digest (last 12 chars) as key - matches Docker events
                short_digest = digest.split(":")[-1][:12]
                layer_sizes[short_digest] = size
                total_size += size

        logger.debug(
            f"Manifest for {image}:{tag}: {len(layers)} layers, "
            f"{total_size / 1024 / 1024:.1f} MB total"
        )

        return layer_sizes

    except requests.RequestException as e:
        logger.warning(f"Failed to get manifest for {image}:{tag}: {e}")
        return None
    except (KeyError, ValueError) as e:
        logger.warning(f"Failed to parse manifest for {image}:{tag}: {e}")
        return None


def check_image_update(
    image_name: str,
    tag: str = "latest",
    host_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Check if a newer version of a Docker image is available.

    Compares the local image digest with the remote registry digest.
    Uses only HEAD requests - no image data is downloaded.

    Args:
        image_name: Full image name (e.g., 'ghcr.io/digijoe79/audiobook-maker-engines/xtts')
        tag: Image tag to check (default: 'latest')
        host_id: Docker host ID (None for local, or remote host ID)

    Returns:
        Dict with:
            - is_installed: bool - Whether image exists on the host
            - update_available: bool | None - True if update available, None if not installed
            - local_digest: str | None - Short local digest (first 12 chars)
            - remote_digest: str | None - Short remote digest (first 12 chars)
            - error: str | None - Error message if check failed
    """
    full_image = f"{image_name}:{tag}"

    # Check image on host
    try:
        client = get_docker_client(host_id)
        local_image = client.images.get(full_image)
        repo_digests = local_image.attrs.get("RepoDigests", [])

        # Extract digest from RepoDigests (format: "image@sha256:xxx")
        local_digest = None
        for rd in repo_digests:
            if "@sha256:" in rd:
                local_digest = rd.split("@")[1]
                break

    except ImageNotFound:
        return {
            "is_installed": False,
            "update_available": None,
            "local_digest": None,
            "remote_digest": None,
            "error": None,
        }
    except DockerException as e:
        return {
            "is_installed": False,
            "update_available": None,
            "local_digest": None,
            "remote_digest": None,
            "error": str(e),
        }

    # Extract image path for registry API (remove ghcr.io/ prefix)
    image_path = image_name
    if image_name.startswith("ghcr.io/"):
        image_path = image_name[8:]  # Remove "ghcr.io/"

    # Get remote digest
    remote_digest = get_remote_digest(image_path, tag)

    if remote_digest is None:
        return {
            "is_installed": True,
            "update_available": None,
            "local_digest": local_digest[:19] if local_digest else None,  # "sha256:" + 12 chars
            "remote_digest": None,
            "error": "Could not fetch remote digest",
        }

    # Compare digests
    update_available = local_digest != remote_digest

    return {
        "is_installed": True,
        "update_available": update_available,
        "local_digest": local_digest[:19] if local_digest else None,
        "remote_digest": remote_digest[:19] if remote_digest else None,
        "error": None,
    }
