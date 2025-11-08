"""
Database migration runner

Applies database migrations in order and tracks applied migrations.
"""

import sqlite3
import importlib.util
import sys
from pathlib import Path
from typing import List
from loguru import logger


class MigrationRunner:
    """Handles database migrations"""

    def __init__(self, conn: sqlite3.Connection, migrations_dir: Path):
        """
        Initialize migration runner

        Args:
            conn: Database connection
            migrations_dir: Path to migrations directory
        """
        self.conn = conn
        self.migrations_dir = migrations_dir
        self._ensure_migrations_table()

    def _ensure_migrations_table(self):
        """Create migrations tracking table if it doesn't exist"""
        cursor = self.conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS migrations (
                version TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TEXT NOT NULL
            )
        """)
        self.conn.commit()

    def get_applied_migrations(self) -> List[str]:
        """Get list of already applied migration versions"""
        cursor = self.conn.cursor()
        cursor.execute("SELECT version FROM migrations ORDER BY version")
        return [row[0] for row in cursor.fetchall()]

    def get_pending_migrations(self) -> List[Path]:
        """Get list of migration files that haven't been applied yet"""
        if not self.migrations_dir.exists():
            logger.warning(f"Migrations directory not found: {self.migrations_dir}")
            return []

        applied = set(self.get_applied_migrations())
        pending = []

        # Find all Python migration files
        for migration_file in sorted(self.migrations_dir.glob("*.py")):
            if migration_file.stem.startswith("_"):
                continue  # Skip __init__.py and other special files

            # Extract version from filename (e.g., "001_add_tts_jobs" -> "001")
            parts = migration_file.stem.split("_", 1)
            if parts and parts[0] not in applied:
                pending.append(migration_file)

        return pending

    def apply_migration(self, migration_file: Path) -> bool:
        """
        Apply a single migration

        Args:
            migration_file: Path to migration Python file

        Returns:
            True if migration was applied successfully, False otherwise
        """
        try:
            # Extract version and name from filename
            stem = migration_file.stem
            parts = stem.split("_", 1)
            version = parts[0]
            name = parts[1] if len(parts) > 1 else stem

            # Check if already applied
            cursor = self.conn.cursor()
            cursor.execute("SELECT version FROM migrations WHERE version = ?", (version,))
            if cursor.fetchone():
                logger.debug(f"Migration {version} already applied, skipping")
                return True

            # Load migration module dynamically
            spec = importlib.util.spec_from_file_location(stem, migration_file)
            if spec is None or spec.loader is None:
                logger.error(f"Could not load migration module: {migration_file}")
                return False

            module = importlib.util.module_from_spec(spec)
            sys.modules[stem] = module
            spec.loader.exec_module(module)

            # Check for upgrade function
            if not hasattr(module, "upgrade"):
                logger.error(f"Migration {stem} missing 'upgrade' function")
                return False

            # Apply migration
            logger.info(f"Applying migration {version}: {name}")
            module.upgrade(self.conn)

            # Record migration as applied
            from datetime import datetime
            cursor.execute("""
                INSERT INTO migrations (version, name, applied_at)
                VALUES (?, ?, ?)
            """, (version, name, datetime.now().isoformat()))
            self.conn.commit()

            logger.success(f"✓ Migration {version} applied successfully")
            return True

        except Exception as e:
            logger.error(f"Failed to apply migration {migration_file.name}: {e}")
            self.conn.rollback()
            return False

    def run_migrations(self) -> int:
        """
        Run all pending migrations

        Returns:
            Number of migrations applied
        """
        pending = self.get_pending_migrations()

        if not pending:
            logger.debug("No pending migrations")
            return 0

        logger.info(f"Found {len(pending)} pending migration(s)")
        applied_count = 0

        for migration_file in pending:
            if self.apply_migration(migration_file):
                applied_count += 1
            else:
                logger.error("Migration failed, stopping migration process")
                break

        if applied_count > 0:
            logger.info(f"Applied {applied_count} migration(s)")

        return applied_count

    def rollback_migration(self, version: str) -> bool:
        """
        Rollback a specific migration

        Args:
            version: Migration version to rollback

        Returns:
            True if rollback was successful, False otherwise
        """
        try:
            # Find migration file
            migration_files = list(self.migrations_dir.glob(f"{version}_*.py"))
            if not migration_files:
                logger.error(f"Migration file not found for version {version}")
                return False

            migration_file = migration_files[0]
            stem = migration_file.stem

            # Load migration module
            spec = importlib.util.spec_from_file_location(stem, migration_file)
            if spec is None or spec.loader is None:
                logger.error(f"Could not load migration module: {migration_file}")
                return False

            module = importlib.util.module_from_spec(spec)
            sys.modules[stem] = module
            spec.loader.exec_module(module)

            # Check for downgrade function
            if not hasattr(module, "downgrade"):
                logger.error(f"Migration {stem} missing 'downgrade' function")
                return False

            # Apply rollback
            logger.info(f"Rolling back migration {version}")
            module.downgrade(self.conn)

            # Remove migration record
            cursor = self.conn.cursor()
            cursor.execute("DELETE FROM migrations WHERE version = ?", (version,))
            self.conn.commit()

            logger.success(f"✓ Migration {version} rolled back successfully")
            return True

        except Exception as e:
            logger.error(f"Failed to rollback migration {version}: {e}")
            self.conn.rollback()
            return False


def run_all_migrations(db_path: str) -> int:
    """
    Convenience function to run all migrations

    Args:
        db_path: Path to SQLite database

    Returns:
        Number of migrations applied
    """
    from db.database import get_db_connection_simple

    conn = get_db_connection_simple()
    migrations_dir = Path(__file__).parent / "migrations"

    runner = MigrationRunner(conn, migrations_dir)
    return runner.run_migrations()