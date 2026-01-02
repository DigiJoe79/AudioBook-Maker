"""
EngineRepository - CRUD for engine variants (Single Source of Truth)

Manages persistent storage of all engine variants with their settings.
Replaces EngineVariantDiscovery and settings.{type}.variants structure.
"""

import json
import sqlite3
from typing import Any, Dict, List, Optional
from datetime import datetime


def dict_from_row(row: sqlite3.Row) -> Dict[str, Any]:
    """Convert sqlite3.Row to dictionary with JSON parsing."""
    result = dict(row)
    # Parse JSON fields
    for field in ["supported_languages", "parameters", "constraints", "capabilities", "config"]:
        if field in result and result[field]:
            try:
                result[field] = json.loads(result[field])
            except (json.JSONDecodeError, TypeError):
                pass
    return result


class EngineRepository:
    """
    Repository for engine variant operations.

    Central registry for all engine variants (local subprocess and Docker).
    Replaces EngineVariantDiscovery and settings.tts.variants structure.
    """

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    # =========================================================================
    # CRUD Operations
    # =========================================================================

    def upsert(
        self,
        variant_id: str,
        base_engine_name: str,
        engine_type: str,
        host_id: str,
        source: str = "local",
        is_installed: bool = False,
        display_name: Optional[str] = None,
        is_default: bool = False,
        enabled: bool = False,
        keep_running: bool = False,
        default_language: Optional[str] = None,
        parameters: Optional[Dict[str, Any]] = None,
        supported_languages: Optional[List[str]] = None,
        requires_gpu: bool = False,
        venv_path: Optional[str] = None,
        server_script: Optional[str] = None,
        docker_image: Optional[str] = None,
        docker_tag: str = "latest",
        constraints: Optional[Dict[str, Any]] = None,
        capabilities: Optional[Dict[str, Any]] = None,
        config: Optional[Dict[str, Any]] = None,
        config_hash: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Create or update an engine variant.

        Args:
            variant_id: Unique identifier (e.g., "xtts:local", "xtts:docker:local")
            base_engine_name: Base engine name (e.g., "xtts")
            engine_type: Engine type ("tts", "stt", "text", "audio")
            host_id: Host identifier (e.g., "local", "docker:local")
            source: Origin of engine ("local", "catalog", "custom")
            is_installed: Whether the engine is installed
            display_name: Human-readable name (e.g., "XTTS v2 (Local)")
            is_default: Whether this is the default engine for its type
            enabled: Whether the engine is enabled
            keep_running: Whether to keep the engine running
            default_language: Default language
            parameters: Engine-specific parameters (JSON)
            supported_languages: List of supported languages
            requires_gpu: Whether the engine requires GPU
            venv_path: Path to venv (subprocess only)
            server_script: Path to server script (subprocess only)
            docker_image: Docker image name (Docker only)
            docker_tag: Docker image tag (Docker only)
            constraints: Engine constraints (e.g., {"max_text_length": 400}) (JSON)
            capabilities: Engine capabilities (e.g., {"voice_cloning": true}) (JSON)
            config: Full engine.yaml content (JSON)

        Returns:
            Created or updated engine dictionary

        Note:
            default_model_name is now stored in engine_models.is_default (Migration 012)
        """
        now = datetime.now().isoformat()
        cursor = self.conn.cursor()

        # Serialize JSON fields
        params_json = json.dumps(parameters) if parameters else None
        langs_json = json.dumps(supported_languages) if supported_languages else None
        constraints_json = json.dumps(constraints) if constraints else None
        capabilities_json = json.dumps(capabilities) if capabilities else None
        config_json = json.dumps(config) if config else None

        cursor.execute("""
            INSERT INTO engines (
                variant_id, base_engine_name, engine_type, host_id, source,
                is_installed, installed_at, display_name,
                is_default, enabled, keep_running,
                default_language, parameters,
                supported_languages, requires_gpu,
                venv_path, server_script, docker_image, docker_tag,
                constraints, capabilities, config, config_hash,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(variant_id) DO UPDATE SET
                base_engine_name = excluded.base_engine_name,
                engine_type = excluded.engine_type,
                host_id = excluded.host_id,
                source = excluded.source,
                is_installed = excluded.is_installed,
                installed_at = CASE
                    WHEN excluded.is_installed AND NOT engines.is_installed
                    THEN excluded.installed_at
                    ELSE engines.installed_at
                END,
                display_name = excluded.display_name,
                is_default = excluded.is_default,
                enabled = COALESCE(excluded.enabled, engines.enabled),
                keep_running = COALESCE(excluded.keep_running, engines.keep_running),
                default_language = COALESCE(excluded.default_language, engines.default_language),
                parameters = COALESCE(excluded.parameters, engines.parameters),
                supported_languages = COALESCE(excluded.supported_languages, engines.supported_languages),
                requires_gpu = excluded.requires_gpu,
                venv_path = excluded.venv_path,
                server_script = excluded.server_script,
                docker_image = excluded.docker_image,
                docker_tag = excluded.docker_tag,
                constraints = COALESCE(excluded.constraints, engines.constraints),
                capabilities = COALESCE(excluded.capabilities, engines.capabilities),
                config = COALESCE(excluded.config, engines.config),
                config_hash = COALESCE(excluded.config_hash, engines.config_hash),
                updated_at = excluded.updated_at
        """, (
            variant_id, base_engine_name, engine_type, host_id, source,
            is_installed, now if is_installed else None, display_name,
            is_default, enabled, keep_running,
            default_language, params_json,
            langs_json, requires_gpu,
            venv_path, server_script, docker_image, docker_tag,
            constraints_json, capabilities_json, config_json, config_hash,
            now, now
        ))

        self.conn.commit()
        return self.get_by_id(variant_id)

    def update_system_metadata(
        self,
        variant_id: str,
        display_name: str,
        supported_languages: List[str],
        constraints: Dict[str, Any],
        capabilities: Dict[str, Any],
        config: Dict[str, Any],
        config_hash: str,
        parameters: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Update system metadata when YAML config changes.

        Only updates system-controlled fields, preserving user settings like
        enabled, keep_running, default_language.
        Note: default_model is now in engine_models.is_default (Migration 012).

        Parameters are reset to new defaults when config changes.

        Args:
            variant_id: Engine variant ID
            display_name: Human-readable name
            supported_languages: List of supported languages
            constraints: Engine constraints
            capabilities: Engine capabilities
            config: Full engine.yaml content
            config_hash: SHA256 hash of YAML content
            parameters: New default parameters (replaces existing)

        Returns:
            Updated engine dictionary or None if not found
        """
        now = datetime.now().isoformat()
        cursor = self.conn.cursor()

        langs_json = json.dumps(supported_languages) if supported_languages else None
        constraints_json = json.dumps(constraints) if constraints else None
        capabilities_json = json.dumps(capabilities) if capabilities else None
        config_json = json.dumps(config) if config else None
        params_json = json.dumps(parameters) if parameters else None

        cursor.execute("""
            UPDATE engines SET
                display_name = ?,
                supported_languages = ?,
                constraints = ?,
                capabilities = ?,
                config = ?,
                config_hash = ?,
                parameters = ?,
                updated_at = ?
            WHERE variant_id = ?
        """, (
            display_name,
            langs_json,
            constraints_json,
            capabilities_json,
            config_json,
            config_hash,
            params_json,
            now,
            variant_id
        ))

        self.conn.commit()

        if cursor.rowcount > 0:
            return self.get_by_id(variant_id)
        return None

    def get_by_id(self, variant_id: str) -> Optional[Dict[str, Any]]:
        """Get engine by variant_id."""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM engines WHERE variant_id = ?", (variant_id,))
        row = cursor.fetchone()
        return dict_from_row(row) if row else None

    def get_all(self) -> List[Dict[str, Any]]:
        """Get all engines."""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM engines ORDER BY engine_type, display_name")
        return [dict_from_row(row) for row in cursor.fetchall()]

    def get_by_type(self, engine_type: str) -> List[Dict[str, Any]]:
        """Get all engines of a specific type."""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT * FROM engines WHERE engine_type = ? ORDER BY display_name",
            (engine_type,)
        )
        return [dict_from_row(row) for row in cursor.fetchall()]

    def get_installed(self, engine_type: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get all installed engines, optionally filtered by type."""
        cursor = self.conn.cursor()
        if engine_type:
            cursor.execute(
                "SELECT * FROM engines WHERE is_installed = TRUE AND engine_type = ? ORDER BY display_name",
                (engine_type,)
            )
        else:
            cursor.execute(
                "SELECT * FROM engines WHERE is_installed = TRUE ORDER BY engine_type, display_name"
            )
        return [dict_from_row(row) for row in cursor.fetchall()]

    def get_enabled(self, engine_type: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get all enabled engines, optionally filtered by type."""
        cursor = self.conn.cursor()
        if engine_type:
            cursor.execute(
                "SELECT * FROM engines WHERE enabled = TRUE AND engine_type = ? ORDER BY display_name",
                (engine_type,)
            )
        else:
            cursor.execute(
                "SELECT * FROM engines WHERE enabled = TRUE ORDER BY engine_type, display_name"
            )
        return [dict_from_row(row) for row in cursor.fetchall()]

    def get_default(self, engine_type: str) -> Optional[Dict[str, Any]]:
        """Get the default engine for a specific type."""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT * FROM engines WHERE engine_type = ? AND is_default = TRUE",
            (engine_type,)
        )
        row = cursor.fetchone()
        return dict_from_row(row) if row else None

    def get_by_host(self, host_id: str) -> List[Dict[str, Any]]:
        """Get all engines on a specific host."""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT * FROM engines WHERE host_id = ? ORDER BY engine_type, display_name",
            (host_id,)
        )
        return [dict_from_row(row) for row in cursor.fetchall()]

    def get_by_base_name(self, base_engine_name: str) -> List[Dict[str, Any]]:
        """Get all variants of a specific base engine."""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT * FROM engines WHERE base_engine_name = ? ORDER BY host_id",
            (base_engine_name,)
        )
        return [dict_from_row(row) for row in cursor.fetchall()]

    def get_by_source(self, source: str) -> List[Dict[str, Any]]:
        """Get all engines with given source."""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT * FROM engines WHERE source = ?",
            (source,)
        )
        return [dict_from_row(row) for row in cursor.fetchall()]

    def update_catalog_metadata(
        self,
        variant_id: str,
        display_name: str,
        supported_languages: List[str],
        constraints: Dict[str, Any],
        capabilities: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        """
        Update system metadata from catalog, preserving user settings.

        Only updates fields that come from the online catalog.
        Does NOT update: parameters, enabled, keep_running, default_language.

        Args:
            variant_id: Engine variant ID
            display_name: Human-readable name
            supported_languages: List of supported languages
            constraints: Engine constraints
            capabilities: Engine capabilities

        Returns:
            Updated engine dictionary or None if not found
        """
        now = datetime.now().isoformat()
        cursor = self.conn.cursor()

        langs_json = json.dumps(supported_languages) if supported_languages else None
        constraints_json = json.dumps(constraints) if constraints else None
        capabilities_json = json.dumps(capabilities) if capabilities else None

        cursor.execute("""
            UPDATE engines SET
                display_name = ?,
                supported_languages = ?,
                constraints = ?,
                capabilities = ?,
                updated_at = ?
            WHERE variant_id = ?
        """, (
            display_name,
            langs_json,
            constraints_json,
            capabilities_json,
            now,
            variant_id
        ))

        self.conn.commit()

        if cursor.rowcount > 0:
            return self.get_by_id(variant_id)
        return None

    # =========================================================================
    # Settings Updates
    # =========================================================================

    def set_default(self, variant_id: str) -> bool:
        """
        Set an engine as the default for its type.
        Unsets any previous default of the same type.

        Args:
            variant_id: Engine to set as default

        Returns:
            True if successful, False if engine not found
        """
        engine = self.get_by_id(variant_id)
        if not engine:
            return False

        cursor = self.conn.cursor()
        now = datetime.now().isoformat()

        # Unset previous default
        cursor.execute("""
            UPDATE engines SET is_default = FALSE, updated_at = ?
            WHERE engine_type = ? AND is_default = TRUE
        """, (now, engine["engine_type"]))

        # Set new default
        cursor.execute("""
            UPDATE engines SET is_default = TRUE, updated_at = ?
            WHERE variant_id = ?
        """, (now, variant_id))

        self.conn.commit()
        return True

    def clear_default(self, engine_type: str) -> bool:
        """
        Clear the default engine for a type (set no default).

        Args:
            engine_type: Engine type ('tts', 'stt', 'text', 'audio')

        Returns:
            True if a default was cleared, False if no default existed
        """
        cursor = self.conn.cursor()
        now = datetime.now().isoformat()

        cursor.execute("""
            UPDATE engines SET is_default = FALSE, updated_at = ?
            WHERE engine_type = ? AND is_default = TRUE
        """, (now, engine_type))

        affected = cursor.rowcount
        self.conn.commit()
        return affected > 0

    def set_enabled(self, variant_id: str, enabled: bool) -> Optional[Dict[str, Any]]:
        """Enable or disable an engine."""
        cursor = self.conn.cursor()
        now = datetime.now().isoformat()
        cursor.execute("""
            UPDATE engines SET enabled = ?, updated_at = ?
            WHERE variant_id = ?
        """, (enabled, now, variant_id))
        self.conn.commit()
        return self.get_by_id(variant_id)

    def set_keep_running(self, variant_id: str, keep_running: bool) -> Optional[Dict[str, Any]]:
        """Set keep_running flag for an engine."""
        cursor = self.conn.cursor()
        now = datetime.now().isoformat()
        cursor.execute("""
            UPDATE engines SET keep_running = ?, updated_at = ?
            WHERE variant_id = ?
        """, (keep_running, now, variant_id))
        self.conn.commit()
        return self.get_by_id(variant_id)

    def set_installed(self, variant_id: str, is_installed: bool) -> Optional[Dict[str, Any]]:
        """Set is_installed flag for an engine."""
        cursor = self.conn.cursor()
        now = datetime.now().isoformat()
        cursor.execute("""
            UPDATE engines SET is_installed = ?, installed_at = ?, updated_at = ?
            WHERE variant_id = ?
        """, (is_installed, now if is_installed else None, now, variant_id))
        self.conn.commit()
        return self.get_by_id(variant_id)

    def set_pulling(self, variant_id: str, is_pulling: bool) -> Optional[Dict[str, Any]]:
        """Set is_pulling flag for an engine (Docker image pull in progress)."""
        cursor = self.conn.cursor()
        now = datetime.now().isoformat()
        cursor.execute("""
            UPDATE engines SET is_pulling = ?, updated_at = ?
            WHERE variant_id = ?
        """, (is_pulling, now, variant_id))
        self.conn.commit()
        return self.get_by_id(variant_id)

    def update_settings(
        self,
        variant_id: str,
        default_language: Optional[str] = None,
        parameters: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Update engine settings.

        Args:
            variant_id: Engine to update
            default_language: New default language
            parameters: New parameters (merged with existing)

        Returns:
            Updated engine or None if not found

        Note:
            default_model_name is now stored in engine_models.is_default (Migration 012)
            Use EngineModelRepository.set_default_model() instead.
        """
        engine = self.get_by_id(variant_id)
        if not engine:
            return None

        updates = []
        params = []
        now = datetime.now().isoformat()

        if default_language is not None:
            updates.append("default_language = ?")
            params.append(default_language)

        if parameters is not None:
            # Merge with existing parameters
            existing = engine.get("parameters") or {}
            merged = {**existing, **parameters}
            updates.append("parameters = ?")
            params.append(json.dumps(merged))

        if not updates:
            return engine

        updates.append("updated_at = ?")
        params.append(now)
        params.append(variant_id)

        cursor = self.conn.cursor()
        # nosemgrep: python.sqlalchemy.security.sqlalchemy-execute-raw-query.sqlalchemy-execute-raw-query -- column names hardcoded, values parameterized
        cursor.execute(
            f"UPDATE engines SET {', '.join(updates)} WHERE variant_id = ?",
            params
        )
        self.conn.commit()
        return self.get_by_id(variant_id)

    # =========================================================================
    # Installation Management
    # =========================================================================

    def mark_installed(self, variant_id: str) -> Optional[Dict[str, Any]]:
        """Mark an engine as installed."""
        cursor = self.conn.cursor()
        now = datetime.now().isoformat()
        cursor.execute("""
            UPDATE engines SET is_installed = TRUE, installed_at = ?, updated_at = ?
            WHERE variant_id = ?
        """, (now, now, variant_id))
        self.conn.commit()
        return self.get_by_id(variant_id)

    def mark_uninstalled(self, variant_id: str) -> Optional[Dict[str, Any]]:
        """Mark an engine as uninstalled."""
        cursor = self.conn.cursor()
        now = datetime.now().isoformat()
        cursor.execute("""
            UPDATE engines
            SET is_installed = FALSE, installed_at = NULL, enabled = FALSE, updated_at = ?
            WHERE variant_id = ?
        """, (now, variant_id))
        self.conn.commit()
        return self.get_by_id(variant_id)

    def mark_missing_local_uninstalled(self) -> int:
        """
        Mark all local engines not in current scan as uninstalled.
        Used during startup to clean up engines whose venv was deleted.

        Returns:
            Number of engines marked as uninstalled
        """
        cursor = self.conn.cursor()
        now = datetime.now().isoformat()
        cursor.execute("""
            UPDATE engines
            SET is_installed = FALSE, enabled = FALSE, updated_at = ?
            WHERE host_id = 'local' AND is_installed = TRUE
        """, (now,))
        count = cursor.rowcount
        self.conn.commit()
        return count

    # =========================================================================
    # Delete Operations
    # =========================================================================

    def delete(self, variant_id: str) -> bool:
        """
        Delete an engine variant.

        Args:
            variant_id: Engine to delete

        Returns:
            True if deleted, False if not found
        """
        cursor = self.conn.cursor()
        cursor.execute("DELETE FROM engines WHERE variant_id = ?", (variant_id,))
        self.conn.commit()
        return cursor.rowcount > 0

    def delete_by_host(self, host_id: str) -> int:
        """
        Delete all engines on a host.

        Args:
            host_id: Host whose engines to delete

        Returns:
            Number of engines deleted
        """
        cursor = self.conn.cursor()
        cursor.execute("DELETE FROM engines WHERE host_id = ?", (host_id,))
        count = cursor.rowcount
        self.conn.commit()
        return count
