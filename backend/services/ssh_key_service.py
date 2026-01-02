"""
SSH Key Service - Generate and manage SSH keys for remote Docker hosts.

Generates Ed25519 key pairs for each Docker host, enabling passwordless
SSH authentication without requiring manual key setup.

Security Notes:
- Private keys are stored unencrypted (required for unattended operation)
- Keys are restricted on remote hosts to Docker operations only
- Ensure appropriate file system permissions on the keys directory
"""

import os
import socket
import stat
from pathlib import Path

import paramiko
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519
from loguru import logger


# Command restriction for authorized_keys
# This limits the key to Docker operations only - no shell access
DOCKER_COMMAND_RESTRICTION = "/usr/bin/docker system dial-stdio"


class SSHKeyService:
    """
    Manage SSH key pairs for remote Docker hosts.

    Keys are stored in <data_dir>/ssh_keys/ with the naming convention:
    - host_<host_id>: Private key (chmod 600)
    - host_<host_id>.pub: Public key

    Attributes:
        keys_dir: Directory where SSH keys are stored
    """

    def __init__(self, data_dir: str | Path):
        """
        Initialize SSHKeyService.

        Args:
            data_dir: Base data directory (typically config.DATA_DIR)
        """
        self.keys_dir = Path(data_dir) / "ssh_keys"
        self._ensure_keys_directory()

    def _ensure_keys_directory(self) -> None:
        """Create keys directory with restrictive permissions if it doesn't exist."""
        if not self.keys_dir.exists():
            self.keys_dir.mkdir(parents=True, mode=0o700)
            logger.info(f"[SSHKeyService] Created keys directory: {self.keys_dir}")

    def _sanitize_host_id_for_filename(self, host_id: str) -> str:
        """Sanitize host_id for use in filenames (colons not allowed on Windows)."""
        return host_id.replace(":", "-")

    def _get_private_key_path(self, host_id: str) -> Path:
        """Get path to private key file for a host."""
        safe_id = self._sanitize_host_id_for_filename(host_id)
        return self.keys_dir / f"host_{safe_id}"

    def _get_public_key_path(self, host_id: str) -> Path:
        """Get path to public key file for a host."""
        safe_id = self._sanitize_host_id_for_filename(host_id)
        return self.keys_dir / f"host_{safe_id}.pub"

    def generate_key_pair(self, host_id: str) -> tuple[Path, str]:
        """
        Generate Ed25519 key pair for a host.

        Args:
            host_id: Unique identifier for the host

        Returns:
            Tuple of (private_key_path, public_key_string)

        Raises:
            RuntimeError: If key generation fails
        """
        private_key_path = self._get_private_key_path(host_id)
        public_key_path = self._get_public_key_path(host_id)

        # Check if keys already exist
        if private_key_path.exists():
            logger.warning(f"[SSHKeyService] Key pair already exists for host {host_id}")
            public_key = self.get_public_key(host_id)
            if public_key:
                return private_key_path, public_key
            # Public key missing, regenerate
            logger.info(f"[SSHKeyService] Regenerating key pair for host {host_id}")

        try:
            # Generate Ed25519 key pair
            private_key = ed25519.Ed25519PrivateKey.generate()
            public_key = private_key.public_key()

            # Serialize private key (OpenSSH format, no password)
            private_key_bytes = private_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.OpenSSH,
                encryption_algorithm=serialization.NoEncryption()
            )

            # Serialize public key (OpenSSH format)
            public_key_bytes = public_key.public_bytes(
                encoding=serialization.Encoding.OpenSSH,
                format=serialization.PublicFormat.OpenSSH
            )

            # Add comment to public key
            public_key_str = f"{public_key_bytes.decode('utf-8')} audiobook-maker-host-{host_id}"

            # Write private key with restrictive permissions
            private_key_path.write_bytes(private_key_bytes)
            # Set permissions to 600 (owner read/write only)
            if os.name != 'nt':  # chmod doesn't work the same on Windows
                os.chmod(private_key_path, stat.S_IRUSR | stat.S_IWUSR)

            # Write public key
            public_key_path.write_text(public_key_str)

            logger.info(f"[SSHKeyService] Generated key pair for host {host_id}")
            return private_key_path, public_key_str

        except Exception as e:
            logger.error(f"[SSHKeyService] Failed to generate key pair: {e}")
            raise RuntimeError(f"[SSH_KEY_GENERATION_FAILED]error:{e}")

    def get_public_key(self, host_id: str) -> str | None:
        """
        Get public key for an existing host.

        Args:
            host_id: Unique identifier for the host

        Returns:
            Public key string, or None if not found
        """
        public_key_path = self._get_public_key_path(host_id)
        if public_key_path.exists():
            return public_key_path.read_text().strip()
        return None

    def get_private_key_path(self, host_id: str) -> Path | None:
        """
        Get path to private key for Docker SDK connection.

        Args:
            host_id: Unique identifier for the host

        Returns:
            Path to private key, or None if not found
        """
        private_key_path = self._get_private_key_path(host_id)
        if private_key_path.exists():
            return private_key_path
        return None

    def has_key_pair(self, host_id: str) -> bool:
        """
        Check if a key pair exists for a host.

        Args:
            host_id: Unique identifier for the host

        Returns:
            True if both private and public keys exist
        """
        return (
            self._get_private_key_path(host_id).exists() and
            self._get_public_key_path(host_id).exists()
        )

    def get_known_hosts_path(self) -> Path:
        """
        Get path to the application's known_hosts file.

        This file stores host keys for remote Docker hosts,
        separate from the user's ~/.ssh/known_hosts.

        Returns:
            Path to known_hosts file
        """
        return self.keys_dir / "known_hosts"

    def delete_key_pair(self, host_id: str, ssh_url: str | None = None) -> None:
        """
        Remove key pair, SSH config entry, and known_hosts entries when host is deleted.

        Args:
            host_id: Unique identifier for the host
            ssh_url: Optional SSH URL to remove from known_hosts
        """
        private_key_path = self._get_private_key_path(host_id)
        public_key_path = self._get_public_key_path(host_id)

        deleted = False
        if private_key_path.exists():
            private_key_path.unlink()
            deleted = True

        if public_key_path.exists():
            public_key_path.unlink()
            deleted = True

        # Remove from SSH config
        self.remove_from_ssh_config(host_id)

        # Remove from known_hosts if ssh_url provided
        if ssh_url:
            self._remove_from_known_hosts(ssh_url)

        if deleted:
            logger.info(f"[SSHKeyService] Deleted key pair for host {host_id}")

    def get_install_command(self, public_key: str) -> str:
        """
        Generate the authorized_keys install command with restrictions.

        The generated entry restricts the key to Docker operations only,
        limiting potential damage if the key is ever compromised.

        Args:
            public_key: The public key string

        Returns:
            Shell command to add the key to authorized_keys
        """
        # Build the restricted authorized_keys entry
        # Note: Don't use 'restrict' - it blocks multiple SSH channels needed by Docker SDK
        # Instead use specific restrictions that don't break Docker operations
        restrictions = f'command="{DOCKER_COMMAND_RESTRICTION}",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty'
        entry = f"{restrictions} {public_key}"

        # Generate the install command
        command = (
            f"echo '{entry}' >> ~/.ssh/authorized_keys && "
            f"chmod 600 ~/.ssh/authorized_keys"
        )

        return command

    def get_authorized_keys_entry(self, public_key: str) -> str:
        """
        Get the authorized_keys entry with restrictions (without echo wrapper).

        Args:
            public_key: The public key string

        Returns:
            The authorized_keys entry to add
        """
        # Note: Don't use 'restrict' - it blocks multiple SSH channels needed by Docker SDK
        restrictions = f'command="{DOCKER_COMMAND_RESTRICTION}",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty'
        return f"{restrictions} {public_key}"


    # NOTE: get_ssh_config_path() removed - we no longer write to ~/.ssh/config
    # SSH configuration is handled via paramiko with identity files passed directly.

    def _remove_from_known_hosts(self, ssh_url: str) -> None:
        """
        Remove entries from known_hosts for a given SSH URL.

        Args:
            ssh_url: SSH URL (e.g., ssh://user@192.168.1.100:22)
        """
        from urllib.parse import urlparse

        known_hosts_path = self.keys_dir / "known_hosts"
        if not known_hosts_path.exists():
            return

        parsed = urlparse(ssh_url)
        hostname = parsed.hostname or ""
        port = parsed.port or 22

        if not hostname:
            return

        # Build patterns to match in known_hosts
        # Standard port: "hostname " or "hostname,"
        # Non-standard port: "[hostname]:port "
        patterns = [f"{hostname} ", f"{hostname},"]
        if port != 22:
            patterns.append(f"[{hostname}]:{port} ")

        try:
            lines = known_hosts_path.read_text().splitlines()
            filtered_lines = [
                line for line in lines
                if not any(line.startswith(pattern) for pattern in patterns)
            ]

            # Only write if we removed something
            if len(filtered_lines) < len(lines):
                known_hosts_path.write_text("\n".join(filtered_lines) + "\n" if filtered_lines else "")
                removed_count = len(lines) - len(filtered_lines)
                logger.info(f"[SSHKeyService] Removed {removed_count} known_hosts entries for {hostname}")

        except Exception as e:
            logger.warning(f"[SSHKeyService] Failed to clean known_hosts: {e}")

    def _scan_host_key(self, hostname: str, port: int = 22) -> None:
        """
        Scan and save the host key for a remote host using paramiko.

        Uses paramiko's Transport to fetch the host key directly,
        avoiding dependency on system SSH tools (ssh-keyscan).
        This ensures cross-platform compatibility (Windows + Linux).

        Args:
            hostname: Remote host IP or hostname
            port: SSH port (default 22)
        """
        known_hosts_path = self.keys_dir / "known_hosts"

        try:
            # Create socket connection to the SSH server
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(10)
            sock.connect((hostname, port))

            # Create paramiko transport to get the host key
            transport = paramiko.Transport(sock)
            try:
                # Start the transport - this negotiates KEX and gets host key
                transport.connect()
                host_key = transport.get_remote_server_key()

                # Format the host key entry for known_hosts
                key_type = host_key.get_name()
                key_base64 = host_key.get_base64()

                # Build the known_hosts line
                # Format: hostname key_type key_base64
                # For non-standard ports: [hostname]:port key_type key_base64
                if port == 22:
                    host_entry = hostname
                else:
                    host_entry = f"[{hostname}]:{port}"

                known_hosts_line = f"{host_entry} {key_type} {key_base64}\n"

                # Check if this host key is already in known_hosts
                existing_entries = set()
                if known_hosts_path.exists():
                    with open(known_hosts_path, "r") as f:
                        for line in f:
                            line = line.strip()
                            if line and not line.startswith("#"):
                                # Extract hostname from line
                                parts = line.split()
                                if len(parts) >= 3:
                                    existing_entries.add(parts[0])

                # Only add if not already present
                if host_entry not in existing_entries:
                    with open(known_hosts_path, "a") as f:
                        f.write(known_hosts_line)
                    logger.info(
                        f"[SSHKeyService] Added {key_type} host key for "
                        f"{hostname}:{port} (paramiko)"
                    )
                else:
                    logger.debug(
                        f"[SSHKeyService] Host key for {hostname}:{port} "
                        "already in known_hosts"
                    )

            finally:
                transport.close()

        except socket.timeout:
            logger.warning(f"[SSHKeyService] Connection timeout for {hostname}:{port}")
        except socket.error as e:
            logger.warning(
                f"[SSHKeyService] Socket error connecting to {hostname}:{port}: {e}"
            )
        except paramiko.SSHException as e:
            logger.warning(
                f"[SSHKeyService] SSH error scanning {hostname}:{port}: {e}"
            )
        except Exception as e:
            logger.warning(f"[SSHKeyService] Failed to scan host key: {e}")

    def scan_and_save_host_key(self, ssh_url: str) -> None:
        """
        Scan and save the host key for a remote host.

        This is called when a new remote Docker host is configured.
        The host key is saved to our custom known_hosts file (not ~/.ssh/known_hosts).

        Args:
            ssh_url: SSH URL (e.g., ssh://user@192.168.1.100)
        """
        from urllib.parse import urlparse

        parsed = urlparse(ssh_url)
        hostname = parsed.hostname or ""
        port = parsed.port or 22

        # Scan and save host key using paramiko
        self._scan_host_key(hostname, port)

    def update_ssh_config(self, host_id: str, ssh_url: str) -> None:
        """
        Scan and save host key for a remote host.

        NOTE: This method no longer writes to ~/.ssh/config.
        SSH configuration is now handled directly via paramiko,
        with identity files passed programmatically.

        Args:
            host_id: Unique identifier for the host
            ssh_url: SSH URL (e.g., ssh://user@192.168.1.100)
        """
        # Just scan and save the host key - no ~/.ssh/config modification
        self.scan_and_save_host_key(ssh_url)
        logger.info(f"[SSHKeyService] Scanned host key for {host_id}")

    def remove_from_ssh_config(self, host_id: str) -> None:
        """
        Remove SSH config entry for a host.

        NOTE: This is now a no-op since we no longer write to ~/.ssh/config.
        Host keys in our custom known_hosts are cleaned up via _clean_known_hosts_for_host().

        Args:
            host_id: Unique identifier for the host
        """
        # No-op: We no longer write to ~/.ssh/config
        # Known hosts cleanup is handled by _clean_known_hosts_for_host()
        pass


    def regenerate_all_ssh_configs(self) -> int:
        """
        Scan and cache host keys for all configured remote Docker hosts.

        Called at startup to ensure host keys are available in our
        custom known_hosts file. This enables paramiko to connect
        without prompting for host key verification.

        NOTE: This method no longer writes to ~/.ssh/config.
        SSH configuration is now handled directly via paramiko.

        Returns:
            Number of hosts whose host keys were scanned
        """
        from db.database import get_db_connection_simple
        from db.engine_host_repository import EngineHostRepository

        try:
            conn = get_db_connection_simple()
            host_repo = EngineHostRepository(conn)
            docker_hosts = host_repo.get_docker_hosts()

            scanned = 0
            for host in docker_hosts:
                host_id = host["host_id"]
                ssh_url = host.get("ssh_url")

                # Skip docker:local (no SSH needed)
                if host["host_type"] == "docker:local":
                    continue

                # Only scan if we have keys for this host
                if ssh_url and self.has_key_pair(host_id):
                    self.scan_and_save_host_key(ssh_url)
                    scanned += 1

            if scanned > 0:
                logger.info(
                    f"[SSHKeyService] Scanned host keys for {scanned} host(s)"
                )

            return scanned

        except Exception as e:
            logger.error(f"[SSHKeyService] Failed to scan host keys: {e}")
            return 0


# Singleton instance (initialized on first use)
_ssh_key_service: SSHKeyService | None = None


def get_ssh_key_service() -> SSHKeyService:
    """
    Get the SSHKeyService singleton instance.

    Returns:
        SSHKeyService instance
    """
    global _ssh_key_service
    if _ssh_key_service is None:
        from config import DATA_DIR
        _ssh_key_service = SSHKeyService(DATA_DIR)
    return _ssh_key_service
