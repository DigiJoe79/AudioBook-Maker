"""
Custom SSH HTTP Adapter for Docker SDK.

Extends Docker SDK's SSHHTTPAdapter to support:
- Custom known_hosts file location (not just ~/.ssh/known_hosts)
- Paramiko-based connections (no dependency on system SSH client)
- Cross-platform compatibility (Windows VENV + Linux Docker)
- Direct identity file passing (no ~/.ssh/config dependency)

This adapter does NOT use ~/.ssh/config. All parameters are passed directly:
- identity_file: Private key path
- custom_known_hosts_path: Host keys file path
- hostname, port, username: Parsed from SSH URL
"""

import logging
import urllib.parse
from pathlib import Path
from typing import Optional

import paramiko
from docker.transport import SSHHTTPAdapter
from docker import APIClient, DockerClient
from loguru import logger

from core.exceptions import ApplicationError

# Suppress paramiko's verbose error logging for expected connection failures
# (host reboots, network issues, etc.) - these are handled gracefully by DockerHostMonitor
logging.getLogger("paramiko").setLevel(logging.CRITICAL)
logging.getLogger("paramiko.transport").setLevel(logging.CRITICAL)


class CustomSSHHTTPAdapter(SSHHTTPAdapter):
    """
    SSH HTTP Adapter with custom known_hosts and identity file support.

    This adapter extends Docker SDK's SSHHTTPAdapter to:
    - Load host keys from a custom location (not ~/.ssh/known_hosts)
    - Use a specific identity file (private key) directly
    - Avoid polluting user's ~/.ssh/config

    Attributes:
        custom_known_hosts_path: Path to application's known_hosts file
        identity_file: Path to private key file for authentication
    """

    def __init__(
        self,
        base_url: str,
        timeout: int = 60,
        pool_connections: int = 1,
        max_pool_size: int = 1,
        custom_known_hosts_path: Optional[Path] = None,
        identity_file: Optional[Path] = None,
    ):
        """
        Initialize CustomSSHHTTPAdapter.

        Args:
            base_url: SSH URL (e.g., "ssh://user@host:22")
            timeout: Connection timeout in seconds
            pool_connections: Number of connection pools (1 for SSH to avoid
                             channel exhaustion with dial-stdio)
            max_pool_size: Maximum connections per pool (1 for SSH)
            custom_known_hosts_path: Path to custom known_hosts file.
                                    If None, only system keys are used.
            identity_file: Path to private key file for authentication.
                          If None, paramiko's default key discovery is used.

        Note:
            Pool sizes are kept at 1 because each SSH "connection" in the pool
            is actually an SSH channel running `docker system dial-stdio`.
            Opening multiple channels exhausts the SSH MaxSessions limit.
            With pool_size=1, we reuse a single channel for all requests.
        """
        self.custom_known_hosts_path = custom_known_hosts_path
        self.identity_file = identity_file

        logger.debug(
            "SSH adapter init",
            base_url=base_url,
            timeout=timeout,
            known_hosts=str(custom_known_hosts_path) if custom_known_hosts_path else None,
            identity_file=str(identity_file) if identity_file else None,
        )

        # Don't call parent __init__ yet - we need to set up our path first
        # Parent's __init__ calls _create_paramiko_client which we override
        super().__init__(
            base_url=base_url,
            timeout=timeout,
            pool_connections=pool_connections,
            max_pool_size=max_pool_size,
            shell_out=False,  # Always use paramiko, never shell out
        )

    def _create_paramiko_client(self, base_url: str) -> None:
        """
        Create and configure paramiko SSH client.

        Overrides parent to:
        1. Load custom known_hosts file (not ~/.ssh/known_hosts)
        2. Use identity_file directly (not ~/.ssh/config)
        3. Avoid any dependency on user's SSH configuration

        Args:
            base_url: SSH URL to connect to
        """
        self.ssh_client = paramiko.SSHClient()
        logger.debug("Creating paramiko SSH client", base_url=base_url)

        # Load system host keys first (lower priority)
        self.ssh_client.load_system_host_keys()
        logger.debug("Loaded system host keys")

        # Load our custom known_hosts (higher priority, can be saved)
        if self.custom_known_hosts_path and self.custom_known_hosts_path.exists():
            try:
                self.ssh_client.load_host_keys(str(self.custom_known_hosts_path))
                logger.debug(
                    f"[CustomSSHHTTPAdapter] Loaded known_hosts from "
                    f"{self.custom_known_hosts_path}"
                )
            except Exception as e:
                logger.warning(
                    f"[CustomSSHHTTPAdapter] Failed to load known_hosts: {e}"
                )

        # Set policy for unknown hosts
        # We use AutoAddPolicy because we manage host key verification ourselves
        # via the ParamikoHostKeyScanner before connection attempts
        self.ssh_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        logger.debug("Set AutoAddPolicy for unknown hosts")

        # Parse the SSH URL
        parsed = urllib.parse.urlparse(base_url)
        self.ssh_params = {
            "hostname": parsed.hostname,
            "port": parsed.port or 22,
            "username": parsed.username,
        }
        logger.debug(
            "Parsed SSH connection params",
            hostname=self.ssh_params["hostname"],
            port=self.ssh_params["port"],
            username=self.ssh_params["username"],
        )

        # Use identity file directly if provided (no ~/.ssh/config needed)
        if self.identity_file and self.identity_file.exists():
            self.ssh_params["key_filename"] = str(self.identity_file)
            # Don't try fallback keys from ~/.ssh/ when we have an explicit key
            # This prevents "Private key file is encrypted" errors from user's keys
            self.ssh_params["look_for_keys"] = False
            self.ssh_params["allow_agent"] = False
            logger.debug(
                "Using explicit identity file",
                identity_file=str(self.identity_file),
                look_for_keys=False,
                allow_agent=False,
            )
        else:
            logger.debug(
                "No identity file provided, using paramiko default key discovery",
                identity_file=str(self.identity_file) if self.identity_file else None,
            )


class CustomSSHAPIClient(APIClient):
    """
    Docker APIClient that uses CustomSSHHTTPAdapter for SSH connections.

    This subclass bypasses Docker SDK's normal SSH adapter creation
    to use our custom adapter with support for custom known_hosts
    and identity files, without requiring ~/.ssh/config entries.
    """

    def __init__(
        self,
        base_url: str,
        known_hosts_path: Optional[Path] = None,
        identity_file: Optional[Path] = None,
        timeout: int = 60,
        **kwargs
    ):
        """
        Initialize CustomSSHAPIClient.

        Args:
            base_url: SSH URL (e.g., "ssh://user@host:22")
            known_hosts_path: Path to custom known_hosts file
            identity_file: Path to private key file for authentication
            timeout: Connection timeout in seconds
            **kwargs: Additional arguments passed to APIClient
        """
        # Store the real SSH URL - we'll use it for our custom adapter
        self._ssh_base_url = base_url
        self._custom_known_hosts_path = known_hosts_path
        self._custom_identity_file = identity_file

        # IMPORTANT: Pass a dummy non-SSH URL to parent to prevent
        # Docker SDK from creating its own SSH adapter.
        # Also pass version="auto" to skip automatic version detection
        # (we'll do it ourselves after mounting the SSH adapter).
        super().__init__(
            base_url="tcp://127.0.0.1:2375",  # Dummy URL, never actually used
            timeout=timeout,
            version="1.45",  # Temporary version to skip auto-detection
            **kwargs
        )

        # Now set up our custom SSH adapter
        # Pool sizes are 1 by default to avoid SSH channel exhaustion
        logger.debug("Creating CustomSSHHTTPAdapter", ssh_url=self._ssh_base_url)
        self._custom_adapter = CustomSSHHTTPAdapter(
            base_url=self._ssh_base_url,
            timeout=timeout,
            custom_known_hosts_path=self._custom_known_hosts_path,
            identity_file=self._custom_identity_file,
        )
        self.mount("http+docker://ssh", self._custom_adapter)
        self.base_url = "http+docker://ssh"
        logger.debug("Mounted SSH adapter at http+docker://ssh")

        # Now retrieve the actual API version from the remote Docker
        logger.debug("Retrieving Docker API version from remote")
        self._version = self._retrieve_server_version()
        logger.debug("Retrieved Docker API version", version=self._version)


def create_docker_client_with_custom_ssh(
    ssh_url: str,
    known_hosts_path: Optional[Path] = None,
    identity_file: Optional[Path] = None,
    timeout: int = 60,
) -> DockerClient:
    """
    Create a Docker client using our custom SSH adapter.

    This factory function creates a DockerClient that uses paramiko
    for SSH connections with support for custom known_hosts and
    identity files, without requiring ~/.ssh/config entries.

    Args:
        ssh_url: SSH URL (e.g., "ssh://user@host:22")
        known_hosts_path: Path to custom known_hosts file
        identity_file: Path to private key file for authentication
        timeout: Connection timeout in seconds

    Returns:
        Configured DockerClient

    Raises:
        RuntimeError: If connection fails

    Example:
        client = create_docker_client_with_custom_ssh(
            "ssh://joe@192.168.1.100:22",
            known_hosts_path=Path("/app/data/ssh_keys/known_hosts"),
            identity_file=Path("/app/data/ssh_keys/host_docker-abc123")
        )
        client.ping()
    """
    logger.debug(
        "Creating Docker client with custom SSH",
        ssh_url=ssh_url,
        known_hosts_path=str(known_hosts_path) if known_hosts_path else None,
        identity_file=str(identity_file) if identity_file else None,
        timeout=timeout,
    )
    try:
        # Create API client with our custom SSH handling
        api_client = CustomSSHAPIClient(
            base_url=ssh_url,
            known_hosts_path=known_hosts_path,
            identity_file=identity_file,
            timeout=timeout,
        )

        # Create DockerClient without calling __init__ (which would create another APIClient)
        # Then manually set the api attribute
        client = DockerClient.__new__(DockerClient)
        client.api = api_client

        logger.debug("Docker client created successfully", ssh_url=ssh_url)
        return client

    except Exception as e:
        # DEBUG level - caller handles and logs appropriately
        logger.debug("Failed to create Docker client", ssh_url=ssh_url, error=str(e))
        raise ApplicationError("DOCKER_CLIENT_CREATION_FAILED", status_code=503, host=ssh_url, error=str(e))
