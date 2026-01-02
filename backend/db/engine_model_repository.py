"""
EngineModelRepository - CRUD for discovered engine models

Manages persistent storage of discovered models per engine variant.
Models are discovered manually via /engines/{variant_id}/discover-models endpoint.
"""

import json
import sqlite3
from typing import Any, Dict, List, Optional
from datetime import datetime


def dict_from_row(row: sqlite3.Row) -> Dict[str, Any]:
    """Convert sqlite3.Row to dictionary with JSON parsing."""
    result = dict(row)
    # Parse JSON fields
    if "model_info" in result and result["model_info"]:
        try:
            result["model_info"] = json.loads(result["model_info"])
        except (json.JSONDecodeError, TypeError):
            pass
    return result


class EngineModelRepository:
    """
    Repository for engine model operations.

    Stores discovered models for each engine variant.
    """

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    # =========================================================================
    # Read Operations
    # =========================================================================

    def get_by_variant(self, variant_id: str) -> List[Dict[str, Any]]:
        """Get all models for a variant."""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT * FROM engine_models WHERE variant_id = ? ORDER BY model_name",
            (variant_id,)
        )
        return [dict_from_row(row) for row in cursor.fetchall()]

    def get_model_names(self, variant_id: str) -> List[str]:
        """Get just the model names for a variant."""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT model_name FROM engine_models WHERE variant_id = ? ORDER BY model_name",
            (variant_id,)
        )
        return [row[0] for row in cursor.fetchall()]

    def get_default_model(self, variant_id: str) -> Optional[str]:
        """
        Get the default model name for a variant.

        Returns:
            Model name if a default is set, None otherwise
        """
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT model_name FROM engine_models WHERE variant_id = ? AND is_default = 1",
            (variant_id,)
        )
        row = cursor.fetchone()
        return row[0] if row else None

    def set_default_model(self, variant_id: str, model_name: str) -> bool:
        """
        Set the default model for a variant.

        Clears any existing default and sets the new one.
        The model must exist in the engine_models table.

        Args:
            variant_id: Engine variant
            model_name: Model to set as default

        Returns:
            True if successful, False if model doesn't exist
        """
        # Check if model exists
        if not self.exists(variant_id, model_name):
            return False

        cursor = self.conn.cursor()

        # Clear existing default for this variant
        cursor.execute(
            "UPDATE engine_models SET is_default = 0 WHERE variant_id = ?",
            (variant_id,)
        )

        # Set new default
        cursor.execute(
            "UPDATE engine_models SET is_default = 1 WHERE variant_id = ? AND model_name = ?",
            (variant_id, model_name)
        )

        self.conn.commit()
        return True

    def clear_default_model(self, variant_id: str) -> None:
        """Clear the default model for a variant."""
        cursor = self.conn.cursor()
        cursor.execute(
            "UPDATE engine_models SET is_default = 0 WHERE variant_id = ?",
            (variant_id,)
        )
        self.conn.commit()

    def get_model(self, variant_id: str, model_name: str) -> Optional[Dict[str, Any]]:
        """Get a specific model entry."""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT * FROM engine_models WHERE variant_id = ? AND model_name = ?",
            (variant_id, model_name)
        )
        row = cursor.fetchone()
        return dict_from_row(row) if row else None

    def exists(self, variant_id: str, model_name: str) -> bool:
        """Check if a model exists for a variant."""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT 1 FROM engine_models WHERE variant_id = ? AND model_name = ?",
            (variant_id, model_name)
        )
        return cursor.fetchone() is not None

    # =========================================================================
    # Write Operations
    # =========================================================================

    def get_default_or_first_model(self, variant_id: str) -> Optional[str]:
        """
        Get the default model, or first available model if no default is set.

        This is the preferred method for getting a model when none is specified.

        Returns:
            Model name or None if no models exist
        """
        # Try default first
        default = self.get_default_model(variant_id)
        if default:
            return default

        # Fall back to first available
        models = self.get_model_names(variant_id)
        return models[0] if models else None

    def add_model(
        self,
        variant_id: str,
        model_name: str,
        model_info: Optional[Dict[str, Any]] = None,
        is_default: bool = False,
    ) -> Dict[str, Any]:
        """
        Add a discovered model.

        Args:
            variant_id: Engine variant
            model_name: Model name
            model_info: Optional model metadata
            is_default: Set as default model for this variant

        Returns:
            Created model entry
        """
        now = datetime.now().isoformat()
        cursor = self.conn.cursor()

        # If setting as default, clear any existing default first
        if is_default:
            cursor.execute(
                "UPDATE engine_models SET is_default = 0 WHERE variant_id = ?",
                (variant_id,)
            )

        cursor.execute("""
            INSERT OR IGNORE INTO engine_models (variant_id, model_name, model_info, discovered_at, is_default)
            VALUES (?, ?, ?, ?, ?)
        """, (
            variant_id,
            model_name,
            json.dumps(model_info) if model_info else None,
            now,
            1 if is_default else 0,
        ))

        self.conn.commit()
        return self.get_model(variant_id, model_name)

    def replace_models(
        self,
        variant_id: str,
        models: List[Dict[str, Any]],
        preserve_default: bool = True,
    ) -> List[Dict[str, Any]]:
        """
        Replace all models for a variant with new discovery results.

        Args:
            variant_id: Engine variant
            models: List of model dicts with "name", optional "info", and optional "is_default"
            preserve_default: If True, preserve the existing default if it still exists in new models

        Returns:
            List of created model entries
        """
        now = datetime.now().isoformat()
        cursor = self.conn.cursor()

        # Remember current default if preserving
        current_default = None
        if preserve_default:
            current_default = self.get_default_model(variant_id)

        # Delete existing models
        cursor.execute("DELETE FROM engine_models WHERE variant_id = ?", (variant_id,))

        # Track if we need to set a default
        default_set = False
        new_model_names = []

        # Insert new models
        for model in models:
            model_name = model.get("name") or model.get("model_name")
            model_info = model.get("info") or model.get("model_info")
            is_default = model.get("is_default", False)

            if model_name:
                new_model_names.append(model_name)

                # Check if this should be default
                should_be_default = is_default or (
                    preserve_default and current_default == model_name
                )
                if should_be_default and not default_set:
                    is_default = True
                    default_set = True
                else:
                    is_default = False

                cursor.execute("""
                    INSERT INTO engine_models (variant_id, model_name, model_info, discovered_at, is_default)
                    VALUES (?, ?, ?, ?, ?)
                """, (
                    variant_id,
                    model_name,
                    json.dumps(model_info) if model_info else None,
                    now,
                    1 if is_default else 0,
                ))

        self.conn.commit()
        return self.get_by_variant(variant_id)

    def delete_model(self, variant_id: str, model_name: str) -> bool:
        """Delete a specific model."""
        cursor = self.conn.cursor()
        cursor.execute(
            "DELETE FROM engine_models WHERE variant_id = ? AND model_name = ?",
            (variant_id, model_name)
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def delete_by_variant(self, variant_id: str) -> int:
        """Delete all models for a variant."""
        cursor = self.conn.cursor()
        cursor.execute("DELETE FROM engine_models WHERE variant_id = ?", (variant_id,))
        count = cursor.rowcount
        self.conn.commit()
        return count
