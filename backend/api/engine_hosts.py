"""
Engine Hosts API Router

REST endpoints for managing engine host configurations.
Replaces docker_hosts.py with unified host management.
"""

import asyncio
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
import sqlite3
import os

from config import is_subprocess_available
from db.database import get_db
from db.engine_host_repository import EngineHostRepository
from db.engine_repository import EngineRepository
from models.response_models import (
    CamelCaseModel,
    MessageResponse,
    EngineHostResponse,
    EngineHostsListResponse,
    DockerVolumesResponse,
    PrepareHostResponse,
    TestHostResponse,
    HostPublicKeyResponse,
)
from pydantic import Field
from loguru import logger
from services.docker_host_monitor import docker_host_monitor
from services.ssh_key_service import get_ssh_key_service


router = APIRouter(prefix="/api/engine-hosts", tags=["engine-hosts"])


# ============================================================================
# Request Models
# ============================================================================

class CreateEngineHostRequest(CamelCaseModel):
    """Request to create an engine host."""
    name: str = Field(description="Human-readable name")
    ssh_url: str = Field(description="SSH URL (e.g., ssh://user@192.168.1.100)")
    host_id: Optional[str] = Field(None, description="Pre-generated host ID from /prepare endpoint")
    has_gpu: Optional[bool] = Field(None, description="Whether host has GPU capability (from test)")


class DockerVolumesRequest(CamelCaseModel):
    """Request to configure Docker volume mounts."""
    samples_path: Optional[str] = Field(None, description="Host path for speaker samples (null = use upload)")
    models_path: Optional[str] = Field(None, description="Host path for external models (null = none)")


class PrepareHostRequest(CamelCaseModel):
    """Request to prepare a new host (generate SSH key)."""
    name: str = Field(description="Human-readable name for the host")
    ssh_url: str = Field(description="SSH URL (e.g., ssh://user@192.168.1.100)")


# ============================================================================
# Endpoints
# ============================================================================

@router.get("", response_model=EngineHostsListResponse)
async def list_hosts(conn: sqlite3.Connection = Depends(get_db)):
    """
    Get all configured engine hosts.

    Returns all hosts including local subprocess, local Docker, and remote Docker.
    """
    host_repo = EngineHostRepository(conn)
    engine_repo = EngineRepository(conn)

    hosts = host_repo.get_all()

    # Filter subprocess host when not available (backend in Docker)
    if not is_subprocess_available():
        hosts = [h for h in hosts if h["host_id"] != "local"]

    # Enrich with engine count
    host_responses = []
    for host in hosts:
        engines = engine_repo.get_by_host(host["host_id"])
        host_responses.append(EngineHostResponse(
            **host,
            engine_count=len(engines)
        ))

    return EngineHostsListResponse(
        hosts=host_responses,
        count=len(hosts)
    )


@router.get("/{host_id}", response_model=EngineHostResponse)
async def get_host(host_id: str, conn: sqlite3.Connection = Depends(get_db)):
    """Get a specific engine host."""
    host_repo = EngineHostRepository(conn)
    engine_repo = EngineRepository(conn)

    host = host_repo.get_by_id(host_id)
    if not host:
        raise HTTPException(status_code=404, detail=f"[HOST_NOT_FOUND]hostId:{host_id}")

    engines = engine_repo.get_by_host(host_id)
    return EngineHostResponse(**host, engine_count=len(engines))


@router.post("", response_model=EngineHostResponse)
async def create_host(
    request: CreateEngineHostRequest,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Create a new remote Docker host.

    Only remote Docker hosts can be created via API.
    Local subprocess and docker:local hosts are created automatically.

    If host_id is provided (from /prepare endpoint), uses that ID and updates
    the SSH config to use the managed key.
    """
    host_repo = EngineHostRepository(conn)

    host = host_repo.add_docker_host(
        name=request.name,
        ssh_url=request.ssh_url,
        host_id=request.host_id
    )

    # Update has_gpu if provided from test result
    if request.has_gpu is not None:
        host = host_repo.set_has_gpu(host['host_id'], request.has_gpu)

    # Update SSH config if we have a managed key for this host
    ssh_key_service = get_ssh_key_service()
    if ssh_key_service.has_key_pair(host['host_id']):
        ssh_key_service.update_ssh_config(host['host_id'], request.ssh_url)
        logger.info(f"Configured SSH for host {host['host_id']} with managed key")

    logger.info(f"Created engine host: {host['host_id']} ({request.ssh_url}), GPU: {request.has_gpu}")

    # Start monitoring the new host
    asyncio.create_task(docker_host_monitor.add_host(host['host_id']))

    return EngineHostResponse(**host, engine_count=0)


@router.post("/prepare", response_model=PrepareHostResponse)
async def prepare_host(request: PrepareHostRequest):
    """
    Prepare a new remote Docker host by generating an SSH key pair.

    This endpoint generates a dedicated SSH key for the host and returns
    the install command to add the key to the remote host's authorized_keys.

    The key is restricted to Docker operations only for security.

    Returns:
        PrepareHostResponse with host_id, public key, and install command
    """
    import uuid

    # Generate a unique host ID with docker: prefix for consistency
    # Format: docker:abc123 (matches variant runner_id format)
    host_id = f"docker:{uuid.uuid4().hex[:8]}"

    # Generate SSH key pair
    ssh_key_service = get_ssh_key_service()
    try:
        private_key_path, public_key = ssh_key_service.generate_key_pair(host_id)
    except RuntimeError as e:
        raise HTTPException(
            status_code=500,
            detail=f"[SSH_KEY_GENERATION_FAILED]error:{str(e)}"
        )

    # Generate install command and authorized_keys entry
    install_command = ssh_key_service.get_install_command(public_key)
    authorized_keys_entry = ssh_key_service.get_authorized_keys_entry(public_key)

    logger.info(f"Prepared SSH key for host {host_id}")

    return PrepareHostResponse(
        success=True,
        host_id=host_id,
        public_key=public_key,
        install_command=install_command,
        authorized_keys_entry=authorized_keys_entry
    )


class TestHostRequest(CamelCaseModel):
    """Request to test a prepared host connection."""
    host_id: str = Field(description="Host ID from /prepare endpoint")
    ssh_url: str = Field(description="SSH URL for the remote host")


def _test_docker_via_sdk(
    ssh_url: str,
    private_key_path: str,
    known_hosts_path: str,
) -> tuple[bool, str | None, bool, str | None]:
    """
    Test Docker connection using Docker SDK with paramiko.

    This uses the same connection method as DockerHostMonitor,
    ensuring consistency and cross-platform compatibility.

    Args:
        ssh_url: SSH URL (e.g., ssh://user@host:22)
        private_key_path: Path to private key file
        known_hosts_path: Path to known_hosts file

    Returns:
        Tuple of (success, docker_version, has_gpu, error_message)
    """
    from pathlib import Path
    from services.ssh_adapter import create_docker_client_with_custom_ssh
    import docker.errors

    try:
        # Create Docker client using our custom SSH adapter (same as DockerHostMonitor)
        client = create_docker_client_with_custom_ssh(
            ssh_url=ssh_url,
            known_hosts_path=Path(known_hosts_path) if known_hosts_path else None,
            identity_file=Path(private_key_path) if private_key_path else None,
            timeout=30,
        )

        # Test connection by getting Docker info
        info = client.info()
        docker_version = info.get("ServerVersion", "unknown")

        # Check for GPU (nvidia runtime)
        has_gpu = False
        runtimes = info.get("Runtimes", {})
        if isinstance(runtimes, dict):
            has_gpu = "nvidia" in runtimes

        # Close the client
        try:
            client.close()
        except Exception:
            pass

        return True, docker_version, has_gpu, None

    except docker.errors.DockerException as e:
        error_msg = str(e)
        # Categorize Docker errors
        if "authentication" in error_msg.lower() or "permission denied" in error_msg.lower():
            return False, None, False, "SSH_AUTH_FAILED"
        elif "connection refused" in error_msg.lower():
            return False, None, False, "SSH_CONNECTION_REFUSED"
        elif "timeout" in error_msg.lower():
            return False, None, False, "SSH_TIMEOUT"
        else:
            return False, None, False, error_msg
    except Exception as e:
        error_msg = str(e)
        # Categorize common SSH/paramiko errors
        if "encrypted" in error_msg.lower() or "authentication failed" in error_msg.lower():
            # "encrypted" error often means auth failed and paramiko tried fallback keys
            return False, None, False, "SSH_AUTH_FAILED"
        elif "no authentication" in error_msg.lower() or "no suitable" in error_msg.lower():
            return False, None, False, "SSH_AUTH_FAILED"
        elif "connection refused" in error_msg.lower():
            return False, None, False, "SSH_CONNECTION_REFUSED"
        elif "timed out" in error_msg.lower() or "timeout" in error_msg.lower():
            return False, None, False, "SSH_TIMEOUT"
        elif "host key" in error_msg.lower():
            return False, None, False, "SSH_HOST_KEY_ERROR"
        else:
            return False, None, False, error_msg


@router.post("/test", response_model=TestHostResponse)
async def test_host(request: TestHostRequest):
    """
    Test connection to a prepared remote Docker host.

    Uses Docker SDK with paramiko for SSH connection, ensuring
    cross-platform compatibility (Windows + Linux) and consistency
    with the actual Docker connection method.

    Verifies:
    1. SSH connection with generated key
    2. Docker daemon accessibility
    3. GPU capability (nvidia runtime)

    Returns:
        TestHostResponse with connection details and GPU status
    """
    import asyncio

    ssh_key_service = get_ssh_key_service()

    # Check if we have keys for this host
    if not ssh_key_service.has_key_pair(request.host_id):
        return TestHostResponse(
            success=False,
            has_gpu=False,
            has_docker_permission=False,
            error="SSH key not found. Please generate a key first.",
            error_category="SSH_KEY_NOT_FOUND"
        )

    # Scan host key (saves to our known_hosts)
    ssh_key_service.update_ssh_config(request.host_id, request.ssh_url)

    # Get SSH key paths
    private_key_path = ssh_key_service.get_private_key_path(request.host_id)
    known_hosts_path = ssh_key_service.get_known_hosts_path()

    if not private_key_path:
        return TestHostResponse(
            success=False,
            has_gpu=False,
            has_docker_permission=False,
            error="SSH private key not found",
            error_category="SSH_KEY_NOT_FOUND"
        )

    # Run the Docker SDK test in a thread pool (blocking operation)
    loop = asyncio.get_event_loop()
    try:
        success, docker_version, has_gpu, error = await loop.run_in_executor(
            None,
            _test_docker_via_sdk,
            request.ssh_url,
            str(private_key_path),
            str(known_hosts_path),
        )
    except Exception as e:
        return TestHostResponse(
            success=False,
            has_gpu=False,
            has_docker_permission=False,
            error=str(e),
            error_category="SSH_ERROR"
        )

    if not success:
        # Map error codes to response
        error_category = "SSH_ERROR"
        error_message = error or "Unknown error"

        if error == "SSH_AUTH_FAILED":
            error_category = "SSH_AUTH_FAILED"
            error_message = "SSH key not authorized on remote host"
        elif error == "SSH_CONNECTION_REFUSED":
            error_category = "SSH_CONNECTION_REFUSED"
            error_message = "SSH connection refused"
        elif error == "SSH_TIMEOUT":
            error_category = "SSH_TIMEOUT"
            error_message = "Connection timeout"
        elif error and "permission denied" in error.lower() and "docker" in error.lower():
            error_category = "DOCKER_PERMISSION_DENIED"
            error_message = "User not in docker group"

        return TestHostResponse(
            success=False,
            has_gpu=False,
            has_docker_permission=error_category != "DOCKER_PERMISSION_DENIED",
            error=error_message,
            error_category=error_category
        )

    logger.info(f"Host {request.host_id} test successful: Docker {docker_version}, GPU: {has_gpu}")

    return TestHostResponse(
        success=True,
        docker_version=docker_version,
        has_gpu=has_gpu,
        has_docker_permission=True,
        error=None,
        error_category=None
    )


@router.delete("/prepare/{host_id}", response_model=MessageResponse)
async def cleanup_prepared_host(host_id: str):
    """
    Clean up a prepared host that was not saved.

    Deletes the SSH key pair generated during prepare.
    Called when user cancels the add host dialog.
    """
    ssh_key_service = get_ssh_key_service()

    if ssh_key_service.has_key_pair(host_id):
        ssh_key_service.delete_key_pair(host_id)
        logger.info(f"Cleaned up prepared host: {host_id}")
        return MessageResponse(success=True, message=f"Cleaned up host {host_id}")

    # No keys to clean up - that's ok
    return MessageResponse(success=True, message="Nothing to clean up")


@router.delete("/{host_id}", response_model=MessageResponse)
async def delete_host(host_id: str, conn: sqlite3.Connection = Depends(get_db)):
    """
    Delete an engine host.

    Cannot delete the local subprocess host or hosts with installed engines.
    """
    host_repo = EngineHostRepository(conn)
    engine_repo = EngineRepository(conn)

    host = host_repo.get_by_id(host_id)
    if not host:
        raise HTTPException(status_code=404, detail=f"[HOST_NOT_FOUND]hostId:{host_id}")

    # Cannot delete local host
    if host_id == "local":
        raise HTTPException(
            status_code=400,
            detail="[HOST_DELETE_FORBIDDEN]hostId:local;reason:Cannot delete local subprocess host"
        )

    # Check for installed engines
    engines = engine_repo.get_by_host(host_id)
    installed = [e for e in engines if e.get("is_installed")]
    if installed:
        raise HTTPException(
            status_code=400,
            detail=f"[HOST_HAS_ENGINES]hostId:{host_id};count:{len(installed)}"
        )

    # Stop monitoring the host
    asyncio.create_task(docker_host_monitor.remove_host(host_id))

    # Delete SSH keys if they exist (pass ssh_url for known_hosts cleanup)
    ssh_key_service = get_ssh_key_service()
    ssh_key_service.delete_key_pair(host_id, ssh_url=host.get("ssh_url"))

    # Delete the host (will cascade to any non-installed engine entries)
    host_repo.delete(host_id)

    logger.info(f"Deleted engine host: {host_id}")

    return MessageResponse(success=True, message=f"Host {host_id} deleted")


@router.post("/ensure-docker-local", response_model=EngineHostResponse)
async def ensure_docker_local(conn: sqlite3.Connection = Depends(get_db)):
    """
    Ensure docker:local host exists.

    Creates the docker:local host entry if it doesn't exist.
    Used when first enabling Docker support.
    """
    host_repo = EngineHostRepository(conn)

    host = host_repo.ensure_docker_local_exists()

    logger.info("Ensured docker:local host exists")

    return EngineHostResponse(**host, engine_count=0)


@router.get("/{host_id}/volumes", response_model=DockerVolumesResponse)
async def get_docker_volumes(host_id: str, conn: sqlite3.Connection = Depends(get_db)):
    """
    Get Docker volume configuration for a host.

    Returns the configured mount paths for samples and models directories.
    Only applicable to Docker hosts (docker:local, docker:remote).
    """
    host_repo = EngineHostRepository(conn)

    host = host_repo.get_by_id(host_id)
    if not host:
        raise HTTPException(status_code=404, detail=f"[HOST_NOT_FOUND]hostId:{host_id}")

    # Only Docker hosts have volume configuration
    host_type = host.get("host_type", "")
    if not host_type.startswith("docker"):
        raise HTTPException(
            status_code=400,
            detail=f"[HOST_NOT_DOCKER]hostId:{host_id};hostType:{host_type}"
        )

    volumes = host_repo.get_docker_volumes(host_id) or {}

    return DockerVolumesResponse(
        success=True,
        host_id=host_id,
        samples_path=volumes.get("samples"),
        models_path=volumes.get("models")
    )


@router.put("/{host_id}/volumes", response_model=DockerVolumesResponse)
async def set_docker_volumes(
    host_id: str,
    request: DockerVolumesRequest,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Set Docker volume configuration for a host.

    Configures the mount paths for samples and models directories.
    Only applicable to Docker hosts (docker:local, docker:remote).

    For docker:local, paths are validated to exist on the host filesystem.
    For remote hosts, no validation is performed.

    Args:
        samples_path: Host path for speaker samples (null = use upload mechanism)
        models_path: Host path for external models (null = no external models)
    """
    host_repo = EngineHostRepository(conn)

    host = host_repo.get_by_id(host_id)
    if not host:
        raise HTTPException(status_code=404, detail=f"[HOST_NOT_FOUND]hostId:{host_id}")

    # Only Docker hosts have volume configuration
    host_type = host.get("host_type", "")
    if not host_type.startswith("docker"):
        raise HTTPException(
            status_code=400,
            detail=f"[HOST_NOT_DOCKER]hostId:{host_id};hostType:{host_type}"
        )

    # Validate paths for docker:local (backend runs on same machine)
    validation_error = None
    if host_type == "docker:local":
        invalid_paths = []
        if request.samples_path and not os.path.isdir(request.samples_path):
            invalid_paths.append(f"samples: {request.samples_path}")
        if request.models_path and not os.path.isdir(request.models_path):
            invalid_paths.append(f"models: {request.models_path}")

        if invalid_paths:
            validation_error = f"Path(s) not found: {', '.join(invalid_paths)}"
            logger.warning(f"Volume path validation failed for {host_id}: {validation_error}")

    # Save configuration (even with validation warning)
    host_repo.set_docker_volumes(
        host_id=host_id,
        samples_path=request.samples_path,
        models_path=request.models_path
    )

    logger.info(f"Updated Docker volumes for {host_id}: samples={request.samples_path}, models={request.models_path}")

    return DockerVolumesResponse(
        success=True,
        host_id=host_id,
        samples_path=request.samples_path,
        models_path=request.models_path,
        validation_error=validation_error
    )


@router.get("/{host_id}/public-key", response_model=HostPublicKeyResponse)
async def get_host_public_key(host_id: str, conn: sqlite3.Connection = Depends(get_db)):
    """
    Get the SSH public key for a remote Docker host.

    Returns the public key that was generated for this host, along with
    the install command to add it to the remote host's authorized_keys.

    Only applicable to remote Docker hosts (docker:remote).
    """
    host_repo = EngineHostRepository(conn)

    host = host_repo.get_by_id(host_id)
    if not host:
        raise HTTPException(status_code=404, detail=f"[HOST_NOT_FOUND]hostId:{host_id}")

    # Only remote Docker hosts have SSH keys
    host_type = host.get("host_type", "")
    if host_type != "docker:remote":
        return HostPublicKeyResponse(
            success=False,
            host_id=host_id,
            public_key=None,
            install_command=None
        )

    ssh_key_service = get_ssh_key_service()
    public_key = ssh_key_service.get_public_key(host_id)

    if not public_key:
        return HostPublicKeyResponse(
            success=False,
            host_id=host_id,
            public_key=None,
            install_command=None
        )

    install_command = ssh_key_service.get_install_command(public_key)

    return HostPublicKeyResponse(
        success=True,
        host_id=host_id,
        public_key=public_key,
        install_command=install_command
    )
