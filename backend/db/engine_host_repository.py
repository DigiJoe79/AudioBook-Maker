"""
EngineHostRepository - CRUD for engine host configurations

Manages persistent storage of engine hosts (local, docker:local, docker:remote).
Replaces and extends DockerHostRepository for unified host management.
"""

import json
import sqlite3
from typing import Any, Dict, List, Optional
from datetime import datetime
from loguru import logger


def dict_from_row(row: sqlite3.Row) -> Dict[str, Any]:
    """Convert sqlite3.Row to dictionary with JSON parsing."""
    result = dict(row)
    # Parse docker_volumes JSON field if present
    if "docker_volumes" in result and result["docker_volumes"]:
        try:
            result["docker_volumes"] = json.loads(result["docker_volumes"])
        except (json.JSONDecodeError, TypeError):
            result["docker_volumes"] = {}
    return result


class EngineHostRepository:
    """
    Repository for engine host operations.

    Manages engine hosts for multi-host engine execution:
    - local: Local subprocess execution
    - docker:local: Local Docker execution
    - docker:<remote>: Remote Docker execution via SSH
    """

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    # =========================================================================
    # CRUD Operations
    # =========================================================================

    def create(
        self,
        host_id: str,
        host_type: str,
        display_name: str,
        ssh_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Create a new engine host entry.

        Args:
            host_id: Unique identifier (e.g., "local", "docker:local", "docker:gpu-server")
            host_type: Host type ("subprocess", "docker:local", "docker:remote")
            display_name: Human-readable name (e.g., "Local Machine", "GPU Server")
            ssh_url: SSH URL for remote Docker hosts (e.g., "ssh://user@192.168.1.100")

        Returns:
            Created host dictionary

        Note:
            Docker hosts are created with is_available=FALSE (pessimistic).
            The DockerHostMonitor will update to TRUE after successful ping.
            Subprocess hosts are created with is_available=TRUE (always local).
        """
        now = datetime.now().isoformat()
        cursor = self.conn.cursor()

        # Subprocess hosts are always available (local), Docker hosts start as unavailable
        # until DockerHostMonitor verifies connectivity
        is_available = host_type == "subprocess"

        cursor.execute("""
            INSERT INTO engine_hosts (host_id, host_type, display_name, ssh_url, is_available, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (host_id, host_type, display_name, ssh_url, is_available, now))

        self.conn.commit()
        logger.debug(
            "[EngineHostRepository] create host",
            host_id=host_id,
            host_type=host_type,
            display_name=display_name,
            is_available=is_available
        )
        return self.get_by_id(host_id)

    def get_by_id(self, host_id: str) -> Optional[Dict[str, Any]]:
        """Get host by ID."""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM engine_hosts WHERE host_id = ?", (host_id,))
        row = cursor.fetchone()
        return dict_from_row(row) if row else None

    def get_all(self) -> List[Dict[str, Any]]:
        """Get all hosts."""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT * FROM engine_hosts
            ORDER BY
                CASE host_type
                    WHEN 'subprocess' THEN 1
                    WHEN 'docker:local' THEN 2
                    ELSE 3
                END,
                display_name
        """)
        return [dict_from_row(row) for row in cursor.fetchall()]

    def get_by_type(self, host_type: str) -> List[Dict[str, Any]]:
        """Get all hosts of a specific type."""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT * FROM engine_hosts WHERE host_type = ? ORDER BY display_name",
            (host_type,)
        )
        return [dict_from_row(row) for row in cursor.fetchall()]

    def get_local(self) -> Optional[Dict[str, Any]]:
        """Get the local subprocess host entry."""
        return self.get_by_id("local")

    def get_docker_local(self) -> Optional[Dict[str, Any]]:
        """Get the local Docker host entry."""
        return self.get_by_id("docker:local")

    def get_docker_hosts(self) -> List[Dict[str, Any]]:
        """Get all Docker hosts (local and remote)."""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT * FROM engine_hosts
            WHERE host_type LIKE 'docker:%'
            ORDER BY
                CASE host_type WHEN 'docker:local' THEN 1 ELSE 2 END,
                display_name
        """)
        return [dict_from_row(row) for row in cursor.fetchall()]

    def get_available(self) -> List[Dict[str, Any]]:
        """Get all available hosts."""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT * FROM engine_hosts WHERE is_available = TRUE ORDER BY display_name"
        )
        return [dict_from_row(row) for row in cursor.fetchall()]

    def is_host_available(self, host_id: str) -> bool:
        """
        Check if a host is available for engine operations.

        Args:
            host_id: Host identifier (e.g., 'local', 'docker:local', 'docker:gpu-server')

        Returns:
            True if host exists and is available, False otherwise.
        """
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT is_available FROM engine_hosts WHERE host_id = ?",
            (host_id,)
        )
        row = cursor.fetchone()
        if not row:
            return False
        return bool(row[0])

    # =========================================================================
    # Update Operations
    # =========================================================================

    def update(
        self,
        host_id: str,
        display_name: Optional[str] = None,
        ssh_url: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Update host configuration.

        Args:
            host_id: Host to update
            display_name: New display name (optional)
            ssh_url: New SSH URL (optional)

        Returns:
            Updated host or None if not found
        """
        updates = []
        params = []

        if display_name is not None:
            updates.append("display_name = ?")
            params.append(display_name)
        if ssh_url is not None:
            updates.append("ssh_url = ?")
            params.append(ssh_url)

        if not updates:
            return self.get_by_id(host_id)

        params.append(host_id)

        cursor = self.conn.cursor()
        # nosemgrep: python.sqlalchemy.security.sqlalchemy-execute-raw-query.sqlalchemy-execute-raw-query -- column names hardcoded, values parameterized
        cursor.execute(
            f"UPDATE engine_hosts SET {', '.join(updates)} WHERE host_id = ?",
            params
        )
        self.conn.commit()

        return self.get_by_id(host_id)

    def set_available(self, host_id: str, is_available: bool) -> Optional[Dict[str, Any]]:
        """
        Update host availability status.

        Args:
            host_id: Host to update
            is_available: New availability status

        Returns:
            Updated host or None if not found
        """
        now = datetime.now().isoformat()
        cursor = self.conn.cursor()
        cursor.execute("""
            UPDATE engine_hosts
            SET is_available = ?, last_checked_at = ?
            WHERE host_id = ?
        """, (is_available, now, host_id))
        self.conn.commit()
        logger.debug(
            "[EngineHostRepository] set_available",
            host_id=host_id,
            is_available=is_available
        )
        return self.get_by_id(host_id)

    def update_last_checked(self, host_id: str) -> Optional[Dict[str, Any]]:
        """Update the last_checked_at timestamp."""
        now = datetime.now().isoformat()
        cursor = self.conn.cursor()
        cursor.execute("""
            UPDATE engine_hosts SET last_checked_at = ?
            WHERE host_id = ?
        """, (now, host_id))
        self.conn.commit()
        return self.get_by_id(host_id)

    # =========================================================================
    # Delete Operations
    # =========================================================================

    def delete(self, host_id: str) -> bool:
        """
        Delete a host.

        Args:
            host_id: Host to delete

        Returns:
            True if deleted, False if not found

        Note:
            Cannot delete the "local" subprocess host.
            Deleting a host also deletes associated engines (via FK cascade).
        """
        # Prevent deleting local subprocess host
        if host_id == "local":
            logger.debug("[EngineHostRepository] delete blocked for local host")
            return False

        cursor = self.conn.cursor()
        cursor.execute("DELETE FROM engine_hosts WHERE host_id = ?", (host_id,))
        deleted = cursor.rowcount > 0
        self.conn.commit()
        logger.debug(
            "[EngineHostRepository] delete",
            host_id=host_id,
            deleted=deleted
        )
        return deleted

    # =========================================================================
    # Docker Host Management (for compatibility)
    # =========================================================================

    def add_docker_host(
        self,
        name: str,
        ssh_url: str,
        host_id: str | None = None,
    ) -> Dict[str, Any]:
        """
        Add a remote Docker host.

        Args:
            name: Human-readable name
            ssh_url: SSH connection URL
            host_id: Optional pre-generated host ID (from /prepare endpoint)

        Returns:
            Created host dictionary
        """
        # Use provided host_id or generate from name
        if not host_id:
            base_id = name.lower().replace(" ", "-")
            host_id = f"docker:{base_id}"

        return self.create(
            host_id=host_id,
            host_type="docker:remote",
            display_name=name,
            ssh_url=ssh_url,
        )

    def ensure_docker_local_exists(self) -> Dict[str, Any]:
        """
        Ensure docker:local host exists.

        Returns:
            The docker:local host entry
        """
        existing = self.get_docker_local()
        if existing:
            return existing

        return self.create(
            host_id="docker:local",
            host_type="docker:local",
            display_name="Docker Local",
        )

    # =========================================================================
    # Docker Volume Configuration
    # =========================================================================

    def get_docker_volumes(self, host_id: str) -> Optional[Dict[str, Optional[str]]]:
        """
        Get docker volume configuration for a host.

        Args:
            host_id: Host identifier (e.g., "docker:local", "docker:gpu-server")

        Returns:
            Dictionary with volume paths or None if host not found:
            {
                "samples": "/path/to/samples" or null,
                "models": "/path/to/models" or null
            }
            null values mean "no mount, use upload mechanism"
        """
        host = self.get_by_id(host_id)
        if not host:
            return None
        return host.get("docker_volumes", {})

    def set_has_gpu(self, host_id: str, has_gpu: bool) -> Optional[Dict[str, Any]]:
        """
        Update GPU capability status for a host.

        Args:
            host_id: Host identifier
            has_gpu: Whether the host has GPU (nvidia runtime)

        Returns:
            Updated host or None if not found
        """
        cursor = self.conn.cursor()
        cursor.execute("""
            UPDATE engine_hosts
            SET has_gpu = ?
            WHERE host_id = ?
        """, (has_gpu, host_id))
        self.conn.commit()
        return self.get_by_id(host_id)

    def set_docker_volumes(
        self,
        host_id: str,
        samples_path: Optional[str] = None,
        models_path: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Set docker volume configuration for a host.

        Args:
            host_id: Host identifier
            samples_path: Host path for speaker samples (null = no mount, use upload)
            models_path: Host path for model files (null = no mount)

        Returns:
            Updated host or None if not found
        """
        docker_volumes = {
            "samples": samples_path,
            "models": models_path,
        }

        cursor = self.conn.cursor()
        cursor.execute("""
            UPDATE engine_hosts
            SET docker_volumes = ?
            WHERE host_id = ?
        """, (json.dumps(docker_volumes), host_id))
        self.conn.commit()

        return self.get_by_id(host_id)
