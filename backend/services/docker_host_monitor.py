"""
Docker Host Monitor Service

Background service for monitoring Docker host connections in real-time.
Uses hybrid approach: initial ping + heartbeat fallback with exponential backoff.

Architecture:
- One asyncio task per Docker host
- Initial ping on startup to verify connection
- Periodic heartbeat (30s default) to detect silent disconnects
- Exponential backoff on reconnection (1s -> 2s -> 4s -> max 30s)
- SSE events emitted on connection status changes
- RemoteDockerRunner registration on successful connection

Note: Docker events() stream is not used because it blocks and doesn't
reliably detect all disconnect scenarios (especially SSH drops).
"""

import asyncio
import sys
import threading
from typing import Dict, Optional, Any, Set
from loguru import logger

# Timeout for SSH ping operations (seconds)
# Prevents indefinite blocking when SSH connection hangs
DOCKER_PING_TIMEOUT = 15.0


# ============================================================================
# Suppress BrokenPipeError in finalizers (Docker SDK SSH cleanup issue)
# ============================================================================
# When a remote Docker host closes the SSH connection, the Docker SDK's
# urllib3 connection pools still hold references to the dead SSH sockets.
# When the garbage collector cleans these up, the finalizers try to flush
# stdin on the dead SSH subprocess, causing BrokenPipeError.
# This is harmless but noisy, so we suppress it.

_original_excepthook = sys.excepthook
_original_threading_excepthook = getattr(threading, 'excepthook', None)


def _suppress_ssh_broken_pipe(exc_type, exc_value, exc_tb):
    """Suppress BrokenPipeError from SSH cleanup in finalizers."""
    if exc_type is BrokenPipeError:
        # Check if it's from docker/urllib3 SSH cleanup
        if exc_tb:
            frame = exc_tb.tb_frame
            while frame:
                filename = frame.f_code.co_filename
                if 'sshconn' in filename or 'connectionpool' in filename:
                    # Silently ignore SSH cleanup errors
                    return
                frame = frame.f_back
    # Call original hook for other exceptions
    _original_excepthook(exc_type, exc_value, exc_tb)


def _suppress_ssh_broken_pipe_threading(args):
    """Suppress BrokenPipeError from SSH cleanup in thread finalizers."""
    if args.exc_type is BrokenPipeError:
        exc_tb = args.exc_traceback
        if exc_tb:
            frame = exc_tb.tb_frame
            while frame:
                filename = frame.f_code.co_filename
                if 'sshconn' in filename or 'connectionpool' in filename:
                    return
                frame = frame.f_back
    if _original_threading_excepthook:
        _original_threading_excepthook(args)


# Install the hooks
sys.excepthook = _suppress_ssh_broken_pipe
if hasattr(threading, 'excepthook'):
    threading.excepthook = _suppress_ssh_broken_pipe_threading

try:
    import docker
    from docker import DockerClient
    from docker.errors import DockerException
    DOCKER_AVAILABLE = True
except ImportError:
    DOCKER_AVAILABLE = False
    DockerClient = None
    DockerException = Exception


def _categorize_docker_error(e: Exception) -> tuple[str, str]:
    """
    Categorize Docker/SSH errors for better user feedback.

    Analyzes exception messages to determine the root cause and provides
    user-friendly error messages for display in the UI.

    Args:
        e: The exception to categorize

    Returns:
        Tuple of (error_code, user_friendly_message)

    Error codes:
        - SSH_AUTH_FAILED: SSH authentication failed
        - CONNECTION_REFUSED: Connection refused (Docker daemon not running)
        - CONNECTION_TIMEOUT: Connection timeout
        - DNS_FAILED: Cannot resolve hostname
        - NETWORK_UNREACHABLE: Network unreachable
        - SSH_CONNECTION_FAILED: SSH connection failed
        - DOCKER_NOT_FOUND: Docker not found on remote host
        - CONNECTION_LOST: Generic connection lost (default)
    """
    error_msg = str(e).lower()

    # SSH Authentication errors
    if "permission denied" in error_msg or "authentication failed" in error_msg:
        return "SSH_AUTH_FAILED", "SSH authentication failed - check SSH key permissions"

    # Connection refused (Docker daemon not running or port blocked)
    if "connection refused" in error_msg:
        return "CONNECTION_REFUSED", "Connection refused - Docker daemon may not be running"

    # Timeout errors
    if "timed out" in error_msg or "timeout" in error_msg:
        return "CONNECTION_TIMEOUT", "Connection timeout - host may be unreachable"

    # DNS resolution errors
    if (
        "name resolution" in error_msg
        or "nodename nor servname" in error_msg
        or "getaddrinfo" in error_msg
    ):
        return "DNS_FAILED", "Cannot resolve hostname - check host address"

    # Network unreachable
    if "network is unreachable" in error_msg or "no route to host" in error_msg:
        return "NETWORK_UNREACHABLE", "Network unreachable - check network connection"

    # SSH connection errors
    if "ssh" in error_msg and ("connection" in error_msg or "failed" in error_msg):
        return "SSH_CONNECTION_FAILED", "SSH connection failed - check SSH configuration"

    # Docker-specific errors
    if "docker" in error_msg and "not found" in error_msg:
        return "DOCKER_NOT_FOUND", "Docker not found on remote host"

    # Generic fallback
    return "CONNECTION_LOST", str(e) if str(e) else "Connection lost"


class DockerHostMonitor:
    """
    Background service monitoring Docker host connections.

    Monitors all Docker hosts (local and remote) with periodic heartbeat.
    Emits SSE events when connection status changes.
    """

    def __init__(self):
        """Initialize Docker host monitor"""
        self.running = False
        self._monitor_tasks: Dict[str, asyncio.Task] = {}  # host_id -> Task
        self._clients: Dict[str, DockerClient] = {}  # host_id -> DockerClient
        self._status: Dict[str, bool] = {}  # host_id -> is_connected
        self._reconnect_attempts: Dict[str, int] = {}  # host_id -> attempt count
        self._first_check_done: Dict[str, bool] = {}  # host_id -> has completed first check
        self._registered_runners: Set[str] = set()  # host_ids with registered runners

        logger.debug("[DockerHostMonitor] Initialized")

    async def start(self):
        """
        Start monitoring all Docker hosts from database.

        Queries engine_hosts table for Docker hosts and starts
        a monitoring task for each one.
        """
        if not DOCKER_AVAILABLE:
            logger.warning("[DockerHostMonitor] Docker SDK not installed, skipping")
            return

        if self.running:
            logger.warning("[DockerHostMonitor] Already running")
            return

        self.running = True
        logger.info("[DockerHostMonitor] Starting...")

        # Get Docker hosts from database
        try:
            from db.database import get_db_connection_simple
            from db.engine_host_repository import EngineHostRepository

            conn = get_db_connection_simple()
            host_repo = EngineHostRepository(conn)
            docker_hosts = host_repo.get_docker_hosts()

            for host in docker_hosts:
                host_id = host["host_id"]
                host_type = host["host_type"]
                ssh_url = host.get("ssh_url")

                # Start monitoring task for each host
                task = asyncio.create_task(
                    self._monitor_host(host_id, host_type, ssh_url)
                )
                self._monitor_tasks[host_id] = task
                logger.debug(f"[DockerHostMonitor] Started monitoring {host_id}")

            logger.info(
                f"[DockerHostMonitor] Monitoring {len(docker_hosts)} Docker host(s)"
            )

        except Exception as e:
            logger.error(f"[DockerHostMonitor] Failed to start: {e}")

    async def stop(self):
        """Stop all monitoring tasks gracefully"""
        if not self.running:
            return

        logger.info("[DockerHostMonitor] Stopping...")
        self.running = False

        # Cancel all monitoring tasks
        for host_id, task in self._monitor_tasks.items():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            logger.debug(f"[DockerHostMonitor] Stopped monitoring {host_id}")

        self._monitor_tasks.clear()

        # Close all Docker clients safely
        for host_id, client in list(self._clients.items()):
            self._close_client_safely(client, host_id)

        self._clients.clear()
        self._status.clear()
        self._reconnect_attempts.clear()
        self._first_check_done.clear()
        self._registered_runners.clear()

        logger.info("[DockerHostMonitor] Stopped")

    async def add_host(self, host_id: str):
        """
        Start monitoring a newly added host.

        Called when a new Docker host is created via API.
        """
        if not DOCKER_AVAILABLE or not self.running:
            return

        if host_id in self._monitor_tasks:
            logger.warning(f"[DockerHostMonitor] Already monitoring {host_id}")
            return

        try:
            from db.database import get_db_connection_simple
            from db.engine_host_repository import EngineHostRepository

            conn = get_db_connection_simple()
            host_repo = EngineHostRepository(conn)
            host = host_repo.get_by_id(host_id)

            if not host or not host.get("host_type", "").startswith("docker"):
                return

            task = asyncio.create_task(
                self._monitor_host(host_id, host["host_type"], host.get("ssh_url"))
            )
            self._monitor_tasks[host_id] = task
            logger.info(f"[DockerHostMonitor] Added monitoring for {host_id}")

        except Exception as e:
            logger.error(f"[DockerHostMonitor] Failed to add host {host_id}: {e}")

    async def remove_host(self, host_id: str):
        """
        Stop monitoring a removed host.

        Called when a Docker host is deleted via API.
        Also unregisters the RemoteDockerRunner for this host.
        """
        if host_id not in self._monitor_tasks:
            # Still try to unregister runner even if not actively monitoring
            self._unregister_remote_runner(host_id)
            return

        # Cancel the monitoring task
        task = self._monitor_tasks.pop(host_id, None)
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        # Close the Docker client safely
        client = self._clients.pop(host_id, None)
        if client:
            self._close_client_safely(client, host_id)

        # Unregister the RemoteDockerRunner for this host
        self._unregister_remote_runner(host_id)

        self._status.pop(host_id, None)
        self._reconnect_attempts.pop(host_id, None)
        self._first_check_done.pop(host_id, None)

        logger.info(f"[DockerHostMonitor] Removed monitoring for {host_id}")

    async def _monitor_host(
        self,
        host_id: str,
        host_type: str,
        ssh_url: Optional[str]
    ):
        """
        Main monitoring loop for a single host.

        Attempts to connect, then sends periodic heartbeats.
        On disconnect, uses exponential backoff for reconnection.
        """
        from config import (
            DOCKER_HOST_HEARTBEAT_INTERVAL,
        )
        from services.event_broadcaster import (
            emit_docker_host_connected,
            emit_docker_host_disconnected,
            emit_docker_host_connecting,
        )
        from db.database import get_db_connection_simple
        from db.engine_host_repository import EngineHostRepository

        self._reconnect_attempts[host_id] = 0

        while self.running:
            try:
                # Create or get Docker client
                client = await self._get_or_create_client(host_id, host_type, ssh_url)
                if not client:
                    # Failed to create client - treat as disconnected
                    is_first_check = not self._first_check_done.get(host_id, False)
                    was_connected = self._status.get(host_id, False)
                    self._status[host_id] = False

                    # Update DB
                    try:
                        conn = get_db_connection_simple()
                        host_repo = EngineHostRepository(conn)
                        host_repo.set_available(host_id, False)
                    except Exception as db_e:
                        logger.warning(f"[DockerHostMonitor] DB update failed: {db_e}")

                    # Emit disconnected event (on first check OR if status changed)
                    if is_first_check or was_connected:
                        await emit_docker_host_disconnected(
                            host_id,
                            "Docker SDK not available or client creation failed",
                            "DOCKER_NOT_FOUND"
                        )
                        if is_first_check:
                            logger.info(
                                f"[DockerHostMonitor] {host_id} not available "
                                "(client creation failed)"
                            )
                        else:
                            logger.warning(
                                f"[DockerHostMonitor] {host_id} disconnected "
                                "(client creation failed)"
                            )
                        self._first_check_done[host_id] = True

                    await self._wait_with_backoff(host_id)
                    continue

                # Attempt to ping
                attempt = self._reconnect_attempts.get(host_id, 0) + 1
                if attempt > 1:
                    await emit_docker_host_connecting(host_id, attempt)

                # Run ping in thread pool with timeout (blocking call)
                try:
                    info = await asyncio.wait_for(
                        asyncio.to_thread(self._ping_and_info, client),
                        timeout=DOCKER_PING_TIMEOUT
                    )
                except asyncio.TimeoutError:
                    logger.warning(
                        f"[DockerHostMonitor] Ping timeout for {host_id} "
                        f"(>{DOCKER_PING_TIMEOUT}s)"
                    )
                    # Raise with timeout message so _categorize_docker_error
                    # can properly identify as CONNECTION_TIMEOUT
                    raise DockerException(
                        f"Connection timed out after {DOCKER_PING_TIMEOUT}s"
                    )

                if info:
                    # Connected!
                    is_first_check = not self._first_check_done.get(host_id, False)
                    was_disconnected = not self._status.get(host_id, False)
                    self._status[host_id] = True
                    self._reconnect_attempts[host_id] = 0

                    # Detect GPU capability from Docker info
                    has_gpu = self._detect_gpu_from_info(info)

                    # Update DB (availability + GPU status)
                    try:
                        conn = get_db_connection_simple()
                        host_repo = EngineHostRepository(conn)
                        host_repo.set_available(host_id, True)
                        # Update GPU status on every connect (user might have installed nvidia-docker)
                        host_repo.set_has_gpu(host_id, has_gpu)
                    except Exception as e:
                        logger.warning(f"[DockerHostMonitor] DB update failed: {e}")

                    # Emit connected event (on first check OR if status changed)
                    if is_first_check or was_disconnected:
                        docker_version = info.get("ServerVersion", "unknown")
                        os_info = info.get("OperatingSystem", "unknown")
                        await emit_docker_host_connected(host_id, docker_version, os_info, has_gpu)
                        logger.info(
                            f"[DockerHostMonitor] {host_id} connected "
                            f"(Docker {docker_version}, GPU: {has_gpu})"
                        )
                        self._first_check_done[host_id] = True

                        # Register RemoteDockerRunner for remote hosts on first successful connection
                        if host_type == "docker:remote" and ssh_url:
                            self._register_remote_runner(host_id, ssh_url)

                    # Wait for next heartbeat
                    await asyncio.sleep(DOCKER_HOST_HEARTBEAT_INTERVAL)

                else:
                    # Ping failed
                    raise DockerException("Ping failed")

            except asyncio.CancelledError:
                # Task cancelled, exit gracefully
                break

            except Exception as e:
                # Connection lost or failed
                is_first_check = not self._first_check_done.get(host_id, False)
                was_connected = self._status.get(host_id, False)
                self._status[host_id] = False

                # Close and clear the client so we recreate on next attempt
                # Must close explicitly to avoid BrokenPipeError during GC
                old_client = self._clients.pop(host_id, None)
                if old_client:
                    self._close_client_safely(old_client, host_id)

                # Update DB
                try:
                    conn = get_db_connection_simple()
                    host_repo = EngineHostRepository(conn)
                    host_repo.set_available(host_id, False)
                except Exception as db_e:
                    logger.warning(f"[DockerHostMonitor] DB update failed: {db_e}")

                # Emit disconnected event (on first check OR if status changed)
                if is_first_check or was_connected:
                    # Categorize the error for better user feedback
                    error_code, error_msg = _categorize_docker_error(e)
                    await emit_docker_host_disconnected(
                        host_id, error_msg, error_code
                    )
                    if is_first_check:
                        logger.info(
                            f"[DockerHostMonitor] {host_id} not available: "
                            f"[{error_code}] {error_msg}"
                        )
                    else:
                        logger.warning(
                            f"[DockerHostMonitor] {host_id} disconnected: "
                            f"[{error_code}] {error_msg}"
                        )
                    self._first_check_done[host_id] = True

                # Wait with exponential backoff
                await self._wait_with_backoff(host_id)

        logger.debug(f"[DockerHostMonitor] Monitor loop exited for {host_id}")

    async def _get_or_create_client(
        self,
        host_id: str,
        host_type: str,
        ssh_url: Optional[str]
    ) -> Optional[DockerClient]:
        """
        Get existing Docker client or create a new one.

        For remote hosts, uses CustomSSHHTTPAdapter with paramiko
        for cross-platform SSH support (Windows + Linux).

        Returns None if client creation fails.
        """
        if host_id in self._clients:
            return self._clients[host_id]

        try:
            if host_type == "docker:local":
                # Local Docker daemon
                client = docker.from_env()
            else:
                # Remote Docker via SSH using paramiko (cross-platform)
                if not ssh_url:
                    logger.error(f"[DockerHostMonitor] No SSH URL for {host_id}")
                    return None

                # Import here to avoid circular imports
                from services.ssh_adapter import create_docker_client_with_custom_ssh
                from services.ssh_key_service import get_ssh_key_service

                # Get SSH key paths for this host
                ssh_key_service = get_ssh_key_service()
                known_hosts_path = ssh_key_service.get_known_hosts_path()
                identity_file = ssh_key_service.get_private_key_path(host_id)

                # Create Docker client with our custom SSH adapter
                # No ~/.ssh/config needed - we pass the key directly
                client = create_docker_client_with_custom_ssh(
                    ssh_url=ssh_url,
                    known_hosts_path=known_hosts_path,
                    identity_file=identity_file,
                    timeout=60,
                )

                logger.debug(
                    f"[DockerHostMonitor] Created paramiko-based client for {host_id}"
                )

            self._clients[host_id] = client
            return client

        except Exception as e:
            # Don't log traceback - connection failures are expected when host reboots
            logger.debug(f"[DockerHostMonitor] Failed to create client for {host_id}: {e}")
            return None

    def _ping_and_info(self, client: DockerClient) -> Optional[Dict[str, Any]]:
        """
        Ping Docker daemon and get info (synchronous, runs in thread pool).

        Returns info dict on success, None on failure.
        """
        try:
            client.ping()
            return client.info()
        except Exception:
            return None

    def _detect_gpu_from_info(self, info: Dict[str, Any]) -> bool:
        """
        Detect if Docker host has NVIDIA GPU runtime from info dict.

        Args:
            info: Docker info dict from client.info()

        Returns:
            True if nvidia runtime is available, False otherwise
        """
        try:
            runtimes = info.get("Runtimes", {})
            # Runtimes is a dict like {"nvidia": {...}, "runc": {...}}
            if isinstance(runtimes, dict):
                return "nvidia" in runtimes
            # Fallback: check string representation
            return "nvidia" in str(runtimes).lower()
        except Exception:
            return False

    def _close_client_safely(self, client: DockerClient, host_id: str) -> None:
        """
        Close a Docker client, suppressing BrokenPipeError.

        When an SSH connection is abruptly closed by the remote host,
        attempting to close the client can raise BrokenPipeError because
        the SSH subprocess stdin is no longer valid. This is expected
        and safe to ignore.

        We also need to kill the SSH subprocess to prevent finalizer errors
        when the garbage collector cleans up urllib3 connection pools.
        """
        # First, try to kill the SSH subprocess to prevent finalizer errors
        self._kill_ssh_subprocess(client, host_id)

        try:
            client.close()
        except BrokenPipeError:
            # Expected when SSH connection was closed by remote host
            logger.debug(f"[DockerHostMonitor] SSH pipe already closed for {host_id}")
        except Exception as e:
            # Log other errors but don't raise - we're cleaning up
            logger.debug(f"[DockerHostMonitor] Error closing client {host_id}: {e}")

        # Force garbage collection with stderr suppressed to avoid
        # "Exception ignored in: <finalize object>" messages from urllib3
        self._gc_with_suppressed_stderr()

    def _kill_ssh_subprocess(self, client: DockerClient, host_id: str) -> None:
        """
        Kill the SSH subprocess used by the Docker client.

        The Docker SDK spawns an SSH subprocess for remote connections.
        If the remote host closes the connection, this subprocess becomes
        a zombie, and urllib3's finalizer will fail with BrokenPipeError
        when trying to flush stdin. Killing the subprocess prevents this.
        """
        try:
            # Navigate to the SSH adapter and its connection pool
            # client.api -> requests.Session -> adapters -> SSHHTTPAdapter -> pools
            api = getattr(client, 'api', None)
            if not api:
                return

            session = getattr(api, '_custom_adapter', None) or getattr(api, 'adapters', {}).get('http+docker://ssh')
            if not session:
                # Try getting from the session directly
                session = getattr(api, '_session', None)
                if session:
                    adapters = getattr(session, 'adapters', {})
                    for adapter in adapters.values():
                        self._kill_adapter_ssh_procs(adapter, host_id)
                return

            self._kill_adapter_ssh_procs(session, host_id)

        except Exception as e:
            logger.debug(f"[DockerHostMonitor] Could not kill SSH subprocess for {host_id}: {e}")

    def _kill_adapter_ssh_procs(self, adapter, host_id: str) -> None:
        """Kill SSH processes in an HTTP adapter's connection pool."""
        try:
            # Get the pool manager
            pool_manager = getattr(adapter, 'poolmanager', None)
            if not pool_manager:
                return

            # Get all pools
            pools = getattr(pool_manager, 'pools', None)
            if not pools:
                return

            # Iterate through pools and kill SSH processes
            for pool in pools.values() if hasattr(pools, 'values') else []:
                self._kill_pool_ssh_procs(pool, host_id)

        except Exception as e:
            logger.debug(f"[DockerHostMonitor] Could not access adapter pools for {host_id}: {e}")

    def _kill_pool_ssh_procs(self, pool, host_id: str) -> None:
        """Kill SSH processes in a connection pool."""
        try:
            # Get the pool's queue of connections
            pool_queue = getattr(pool, 'pool', None)
            if not pool_queue:
                return

            # Try to get connections from the queue
            connections = []
            while True:
                try:
                    conn = pool_queue.get_nowait()
                    connections.append(conn)
                except Exception:
                    break

            # Kill SSH process for each connection
            for conn in connections:
                try:
                    # SSHSocket has a 'proc' attribute for the SSH subprocess
                    sock = getattr(conn, 'sock', None)
                    if sock:
                        proc = getattr(sock, 'proc', None)
                        if proc:
                            proc.kill()
                            logger.debug(f"[DockerHostMonitor] Killed SSH process for {host_id}")
                except Exception:
                    pass

            # Put connections back (even though they're dead)
            for conn in connections:
                try:
                    pool_queue.put_nowait(conn)
                except Exception:
                    pass

        except Exception as e:
            logger.debug(f"[DockerHostMonitor] Could not kill pool SSH procs for {host_id}: {e}")

    def _gc_with_suppressed_stderr(self) -> None:
        """
        Run garbage collection with stderr suppressed.

        Python prints "Exception ignored in: <finalize object>" directly to
        stderr when finalizers raise exceptions. We can't catch these via
        excepthook, so we temporarily redirect stderr during gc.collect().
        """
        import gc
        import io
        import os

        try:
            # Save original stderr
            original_stderr = sys.stderr
            original_stderr_fd = os.dup(2)

            # Redirect stderr to /dev/null
            devnull = os.open(os.devnull, os.O_WRONLY)
            os.dup2(devnull, 2)
            sys.stderr = io.StringIO()

            try:
                gc.collect()
            finally:
                # Restore stderr
                os.dup2(original_stderr_fd, 2)
                os.close(original_stderr_fd)
                os.close(devnull)
                sys.stderr = original_stderr

        except Exception:
            # If anything goes wrong, just run gc normally
            gc.collect()

    async def _wait_with_backoff(self, host_id: str):
        """
        Wait with exponential backoff before next reconnection attempt.

        Backoff: 1s -> 2s -> 4s -> 8s -> ... -> max 30s
        """
        from config import (
            DOCKER_HOST_RECONNECT_INITIAL_DELAY,
            DOCKER_HOST_RECONNECT_MAX_DELAY,
        )

        attempt = self._reconnect_attempts.get(host_id, 0) + 1
        self._reconnect_attempts[host_id] = attempt

        delay = min(
            DOCKER_HOST_RECONNECT_INITIAL_DELAY * (2 ** (attempt - 1)),
            DOCKER_HOST_RECONNECT_MAX_DELAY
        )

        logger.debug(
            f"[DockerHostMonitor] {host_id} waiting {delay:.1f}s "
            f"(attempt {attempt})"
        )

        await asyncio.sleep(delay)

    def get_status(self, host_id: str) -> bool:
        """Get current connection status for a host"""
        return self._status.get(host_id, False)

    def get_all_status(self) -> Dict[str, bool]:
        """Get connection status for all monitored hosts"""
        return dict(self._status)

    def get_client(self, host_id: str) -> Optional[DockerClient]:
        """
        Get the Docker client for a connected host.

        Used by docker_service to perform operations on remote hosts.

        Args:
            host_id: The host identifier (e.g., 'docker:abc123')

        Returns:
            DockerClient if host is connected, None otherwise
        """
        if not self._status.get(host_id, False):
            return None
        return self._clients.get(host_id)

    def reconnect(self, host_id: str) -> Optional[DockerClient]:
        """
        Force reconnection to a Docker host.

        Called when an operation fails with ChannelException.
        Closes the old client and creates a fresh SSH connection.

        Args:
            host_id: The host identifier (e.g., 'docker:abc123')

        Returns:
            New DockerClient if reconnection successful, None otherwise
        """
        from db.database import get_db_connection_simple
        from db.engine_host_repository import EngineHostRepository

        logger.warning(f"[DockerHostMonitor] Reconnecting to {host_id}...")

        # Close old client
        old_client = self._clients.pop(host_id, None)
        if old_client:
            self._close_client_safely(old_client, host_id)

        # Get host info from DB
        try:
            conn = get_db_connection_simple()
            host_repo = EngineHostRepository(conn)
            host = host_repo.get_by_id(host_id)

            if not host:
                logger.error(f"[DockerHostMonitor] Host {host_id} not found in DB")
                return None

            host_type = host.get("host_type", "")
            ssh_url = host.get("ssh_url")

            if host_type != "docker:remote" or not ssh_url:
                logger.error(f"[DockerHostMonitor] Host {host_id} is not a remote Docker host")
                return None

            # Create new client
            from services.ssh_adapter import create_docker_client_with_custom_ssh
            from services.ssh_key_service import get_ssh_key_service

            ssh_key_service = get_ssh_key_service()
            known_hosts_path = ssh_key_service.get_known_hosts_path()
            identity_file = ssh_key_service.get_private_key_path(host_id)

            client = create_docker_client_with_custom_ssh(
                ssh_url=ssh_url,
                known_hosts_path=known_hosts_path,
                identity_file=identity_file,
                timeout=60,
            )
            client.ping()

            self._clients[host_id] = client
            logger.info(f"[DockerHostMonitor] Reconnected to {host_id}")
            return client

        except Exception as e:
            logger.error(f"[DockerHostMonitor] Reconnection failed for {host_id}: {e}")
            self._status[host_id] = False
            return None

    def _register_remote_runner(self, host_id: str, ssh_url: str) -> bool:
        """
        Register RemoteDockerRunner for a remote host.

        Called when a remote Docker host successfully connects for the first time.
        Creates a RemoteDockerRunner instance and registers it with the
        EngineRunnerRegistry so engines can be started on this host.

        The runner receives callbacks to get_client and reconnect instead of
        a direct client reference - DockerHostMonitor owns all SSH connections.

        Args:
            host_id: Host identifier (e.g., 'docker:gpu-server')
            ssh_url: SSH URL for the remote host

        Returns:
            True if registration successful, False otherwise
        """
        if host_id in self._registered_runners:
            logger.debug(f"[DockerHostMonitor] Runner already registered for {host_id}")
            return True

        try:
            from core.remote_docker_runner import RemoteDockerRunner
            from core.engine_runner_registry import get_engine_runner_registry

            # Extract display name from host_id (e.g., 'docker:gpu-server' -> 'gpu-server')
            display_name = host_id.replace('docker:', '') if host_id.startswith('docker:') else host_id

            # Create callbacks that capture host_id
            # Runner uses these instead of owning its own client
            def get_client():
                return self.get_client(host_id)

            def reconnect():
                return self.reconnect(host_id)

            # Create RemoteDockerRunner instance with callbacks
            runner = RemoteDockerRunner(
                host_url=ssh_url,
                host_name=display_name,
                host_id=host_id,
                get_client=get_client,
                reconnect=reconnect,
                image_prefix="ghcr.io/digijoe79/audiobook-maker-engines",
            )

            # Register with the engine runner registry
            registry = get_engine_runner_registry()
            registry.register_runner(host_id, runner)

            self._registered_runners.add(host_id)
            logger.info(f"[DockerHostMonitor] Registered RemoteDockerRunner for {host_id}")
            return True

        except Exception as e:
            logger.error(f"[DockerHostMonitor] Failed to register runner for {host_id}: {e}")
            return False

    def _unregister_remote_runner(self, host_id: str) -> None:
        """
        Unregister RemoteDockerRunner for a removed host.

        Called when a remote Docker host is deleted via API.
        Removes the runner from the EngineRunnerRegistry.

        Args:
            host_id: Host identifier to unregister
        """
        if host_id not in self._registered_runners:
            return

        try:
            from core.engine_runner_registry import get_engine_runner_registry

            registry = get_engine_runner_registry()
            registry.unregister_runner(host_id)

            self._registered_runners.discard(host_id)
            logger.info(f"[DockerHostMonitor] Unregistered runner for {host_id}")

        except Exception as e:
            logger.warning(f"[DockerHostMonitor] Failed to unregister runner for {host_id}: {e}")


# Global singleton instance
docker_host_monitor = DockerHostMonitor()
