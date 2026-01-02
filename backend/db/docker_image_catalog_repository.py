"""
DockerImageCatalogRepository - CRUD for Docker image catalog

Manages the static catalog of available Docker images for engine variants.
Replaces docker-images.yaml with database-backed storage.
"""

import json
import sqlite3
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone


def utc_now_iso() -> str:
    """Generate UTC timestamp in ISO format with 'Z' suffix."""
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def dict_from_row(row: sqlite3.Row) -> Dict[str, Any]:
    """Convert sqlite3.Row to dictionary with JSON parsing."""
    result = dict(row)
    # Parse JSON fields
    json_fields = [
        "tags", "supported_languages",
        "constraints", "capabilities", "parameters", "models"
    ]
    for field in json_fields:
        if field in result and result[field]:
            try:
                result[field] = json.loads(result[field])
            except (json.JSONDecodeError, TypeError):
                pass
    return result


class DockerImageCatalogRepository:
    """
    Repository for Docker image catalog operations.

    Provides read access to the catalog of available Docker images
    for engine installation and discovery.
    """

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    # =========================================================================
    # Read Operations
    # =========================================================================

    def get_by_engine_name(self, base_engine_name: str) -> Optional[Dict[str, Any]]:
        """Get catalog entry by base engine name."""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT * FROM docker_image_catalog WHERE base_engine_name = ?",
            (base_engine_name,)
        )
        row = cursor.fetchone()
        return dict_from_row(row) if row else None

    def get_by_image_name(self, image_name: str) -> Optional[Dict[str, Any]]:
        """Get catalog entry by Docker image name."""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT * FROM docker_image_catalog WHERE image_name = ?",
            (image_name,)
        )
        row = cursor.fetchone()
        return dict_from_row(row) if row else None

    def get_all(self) -> List[Dict[str, Any]]:
        """Get all catalog entries."""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT * FROM docker_image_catalog ORDER BY engine_type, display_name"
        )
        return [dict_from_row(row) for row in cursor.fetchall()]

    def get_by_type(self, engine_type: str) -> List[Dict[str, Any]]:
        """Get all catalog entries for a specific engine type."""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT * FROM docker_image_catalog WHERE engine_type = ? ORDER BY display_name",
            (engine_type,)
        )
        return [dict_from_row(row) for row in cursor.fetchall()]

    def get_gpu_required(self) -> List[Dict[str, Any]]:
        """Get all catalog entries that require GPU."""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT * FROM docker_image_catalog WHERE requires_gpu = TRUE ORDER BY display_name"
        )
        return [dict_from_row(row) for row in cursor.fetchall()]

    # =========================================================================
    # Catalog Management
    # =========================================================================

    def add_entry(
        self,
        base_engine_name: str,
        image_name: str,
        engine_type: str,
        display_name: Optional[str] = None,
        requires_gpu: bool = False,
        default_tag: str = "latest",
        tags: Optional[List[str]] = None,
        supported_languages: Optional[List[str]] = None,
        source: str = "custom",
        repo_url: Optional[str] = None,
        description: str = "",
        constraints: Optional[Dict[str, Any]] = None,
        capabilities: Optional[Dict[str, Any]] = None,
        parameters: Optional[Dict[str, Any]] = None,
        models: Optional[List[Dict[str, Any]]] = None,
        default_model: str = "",
        catalog_version: str = "",
    ) -> Dict[str, Any]:
        """
        Add a new catalog entry.

        Args:
            base_engine_name: Base engine name (e.g., "xtts")
            image_name: Docker image name (e.g., "audiobook-maker/xtts")
            engine_type: Engine type ("tts", "stt", "text", "audio")
            display_name: Human-readable name
            requires_gpu: Whether GPU is required
            default_tag: Default image tag
            tags: Available tags
            supported_languages: Supported language codes
            source: Source ("builtin", "custom", "online")
            repo_url: Repository URL
            description: Engine description text
            constraints: Engine constraints (e.g., {"max_text_length": 300})
            capabilities: Engine capabilities (e.g., {"supports_model_hotswap": true})
            parameters: Full parameter schema with type, min, max, default
            models: List of model objects with full metadata
            default_model: Default model name
            catalog_version: Version from catalog.yaml

        Returns:
            Created catalog entry
        """
        now = utc_now_iso()
        cursor = self.conn.cursor()

        cursor.execute("""
            INSERT INTO docker_image_catalog (
                base_engine_name, image_name, engine_type, display_name,
                requires_gpu, default_tag, tags, supported_languages,
                source, repo_url,
                description, constraints, capabilities, parameters,
                models, default_model, catalog_version,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            base_engine_name,
            image_name,
            engine_type,
            display_name or base_engine_name,
            requires_gpu,
            default_tag,
            json.dumps(tags) if tags else None,
            json.dumps(supported_languages) if supported_languages else None,
            source,
            repo_url,
            description,
            json.dumps(constraints) if constraints else None,
            json.dumps(capabilities) if capabilities else None,
            json.dumps(parameters) if parameters else None,
            json.dumps(models) if models else None,
            default_model,
            catalog_version,
            now,
            now,
        ))

        self.conn.commit()
        return self.get_by_engine_name(base_engine_name)

    def update_entry(
        self,
        base_engine_name: str,
        image_name: Optional[str] = None,
        engine_type: Optional[str] = None,
        display_name: Optional[str] = None,
        requires_gpu: Optional[bool] = None,
        tags: Optional[List[str]] = None,
        default_tag: Optional[str] = None,
        supported_languages: Optional[List[str]] = None,
        constraints: Optional[Dict[str, Any]] = None,
        capabilities: Optional[Dict[str, Any]] = None,
        parameters: Optional[Dict[str, Any]] = None,
        models: Optional[List[Dict[str, Any]]] = None,
        default_model: Optional[str] = None,
        source: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Update a catalog entry.

        Args:
            base_engine_name: Engine to update
            image_name: Docker image name
            engine_type: Engine type
            display_name: Human-readable name
            requires_gpu: Whether GPU is required
            tags: Available tags list
            default_tag: Default image tag
            supported_languages: Supported language codes
            constraints: Engine constraints
            capabilities: Engine capabilities
            parameters: Full parameter schema
            models: List of model objects
            default_model: Default model name
            source: Source ("builtin", "custom", "online")

        Returns:
            Updated entry or None if not found
        """
        updates = []
        params = []
        now = utc_now_iso()

        if image_name is not None:
            updates.append("image_name = ?")
            params.append(image_name)

        if engine_type is not None:
            updates.append("engine_type = ?")
            params.append(engine_type)

        if display_name is not None:
            updates.append("display_name = ?")
            params.append(display_name)

        if requires_gpu is not None:
            updates.append("requires_gpu = ?")
            params.append(requires_gpu)

        if tags is not None:
            updates.append("tags = ?")
            params.append(json.dumps(tags))

        if default_tag is not None:
            updates.append("default_tag = ?")
            params.append(default_tag)

        if supported_languages is not None:
            updates.append("supported_languages = ?")
            params.append(json.dumps(supported_languages))

        if constraints is not None:
            updates.append("constraints = ?")
            params.append(json.dumps(constraints))

        if capabilities is not None:
            updates.append("capabilities = ?")
            params.append(json.dumps(capabilities))

        if parameters is not None:
            updates.append("parameters = ?")
            params.append(json.dumps(parameters))

        if models is not None:
            updates.append("models = ?")
            params.append(json.dumps(models))

        if default_model is not None:
            updates.append("default_model = ?")
            params.append(default_model)

        if source is not None:
            updates.append("source = ?")
            params.append(source)

        if not updates:
            return self.get_by_engine_name(base_engine_name)

        updates.append("updated_at = ?")
        params.append(now)
        params.append(base_engine_name)

        cursor = self.conn.cursor()
        # nosemgrep: python.sqlalchemy.security.sqlalchemy-execute-raw-query.sqlalchemy-execute-raw-query -- column names hardcoded, values parameterized
        cursor.execute(
            f"UPDATE docker_image_catalog SET {', '.join(updates)} WHERE base_engine_name = ?",
            params
        )
        self.conn.commit()
        return self.get_by_engine_name(base_engine_name)

    def delete_entry(self, base_engine_name: str) -> bool:
        """
        Delete a catalog entry.

        Args:
            base_engine_name: Engine to delete

        Returns:
            True if deleted, False if not found
        """
        cursor = self.conn.cursor()
        cursor.execute(
            "DELETE FROM docker_image_catalog WHERE base_engine_name = ?",
            (base_engine_name,)
        )
        self.conn.commit()
        return cursor.rowcount > 0
