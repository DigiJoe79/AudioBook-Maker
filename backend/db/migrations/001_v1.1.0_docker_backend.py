"""
Migration 001: v1.1.0 Docker Backend

Consolidated migration for the Docker/Engine system introduced in v1.1.0.
This replaces 15 development migrations (001-016) with a single release migration.

Creates:
- engine_hosts: Host configurations (local, docker:local, remote)
- docker_image_catalog: Available Docker images from online catalog
- engines: Central registry for all engine variants (Single Source of Truth)
- engine_models: Discovered models per engine variant

Migrates (for v1.0.x upgrades):
- segments.tts_engine: Adds ':local' suffix to engine names
- quality_jobs engine fields: Adds ':local' suffix
- global_settings: Migrates engine keys and defaults to variant format
"""

import json
import os
import sqlite3
from loguru import logger


def upgrade(conn: sqlite3.Connection) -> None:
    """
    Create engine system tables and migrate existing data.
    """
    cursor = conn.cursor()

    # =========================================================================
    # 1. Create engine_hosts table
    # =========================================================================
    logger.info("Migration 001: Creating engine_hosts table")
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS engine_hosts (
            host_id TEXT PRIMARY KEY,
            host_type TEXT NOT NULL,
            display_name TEXT NOT NULL,
            ssh_url TEXT,
            is_available BOOLEAN DEFAULT TRUE,
            has_gpu BOOLEAN DEFAULT NULL,
            last_checked_at TEXT,
            docker_volumes TEXT DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)

    # Insert default hosts
    cursor.execute("""
        INSERT OR IGNORE INTO engine_hosts (host_id, host_type, display_name)
        VALUES ('local', 'subprocess', 'Local Machine')
    """)

    # Docker local host with OS-specific URL
    # Starts as unavailable - set to available when Docker is detected at runtime
    local_docker_url = (
        "npipe:////./pipe/docker_engine" if os.name == 'nt'
        else "unix:///var/run/docker.sock"
    )
    cursor.execute("""
        INSERT OR IGNORE INTO engine_hosts (host_id, host_type, display_name, ssh_url, docker_volumes, is_available)
        VALUES ('docker:local', 'docker:local', 'Docker Local', ?, '{"samples": null, "models": null}', FALSE)
    """, (local_docker_url,))

    # =========================================================================
    # 2. Create docker_image_catalog table
    # =========================================================================
    logger.info("Migration 001: Creating docker_image_catalog table")
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS docker_image_catalog (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            base_engine_name TEXT NOT NULL,
            image_name TEXT NOT NULL,
            engine_type TEXT NOT NULL,
            display_name TEXT,
            description TEXT DEFAULT '',
            requires_gpu BOOLEAN DEFAULT FALSE,
            default_tag TEXT DEFAULT 'latest',
            tags TEXT,
            supported_languages TEXT,
            constraints TEXT DEFAULT '{}',
            capabilities TEXT DEFAULT '{}',
            parameters TEXT DEFAULT '{}',
            models TEXT DEFAULT '[]',
            default_model TEXT DEFAULT '',
            catalog_version TEXT DEFAULT '',
            source TEXT DEFAULT 'builtin',
            repo_url TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(base_engine_name, image_name)
        )
    """)

    # =========================================================================
    # 3. Create engines table (Single Source of Truth)
    # =========================================================================
    logger.info("Migration 001: Creating engines table")
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS engines (
            variant_id TEXT PRIMARY KEY,
            base_engine_name TEXT NOT NULL,
            engine_type TEXT NOT NULL,
            host_id TEXT NOT NULL,
            source TEXT DEFAULT 'local',
            is_installed BOOLEAN DEFAULT FALSE,
            installed_at TEXT,
            display_name TEXT,
            is_default BOOLEAN DEFAULT FALSE,
            enabled BOOLEAN DEFAULT FALSE,
            keep_running BOOLEAN DEFAULT FALSE,
            default_language TEXT,
            parameters TEXT,
            supported_languages TEXT,
            requires_gpu BOOLEAN DEFAULT FALSE,
            constraints TEXT,
            capabilities TEXT,
            config TEXT,
            config_hash TEXT,
            venv_path TEXT,
            server_script TEXT,
            docker_image TEXT,
            docker_tag TEXT DEFAULT 'latest',
            is_pulling BOOLEAN DEFAULT FALSE,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (host_id) REFERENCES engine_hosts(host_id)
        )
    """)

    # Create indexes for engines table
    cursor.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_engines_default_per_type
        ON engines(engine_type) WHERE is_default = TRUE
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_engines_type ON engines(engine_type)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_engines_host ON engines(host_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_engines_installed ON engines(is_installed)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_engines_enabled ON engines(enabled)")

    # =========================================================================
    # 4. Create engine_models table
    # =========================================================================
    logger.info("Migration 001: Creating engine_models table")
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS engine_models (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            variant_id TEXT NOT NULL,
            model_name TEXT NOT NULL,
            model_info TEXT,
            is_default INTEGER NOT NULL DEFAULT 0,
            is_available INTEGER NOT NULL DEFAULT 1,
            source TEXT DEFAULT 'discovered',
            discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(variant_id, model_name),
            FOREIGN KEY (variant_id) REFERENCES engines(variant_id) ON DELETE CASCADE
        )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_engine_models_variant ON engine_models(variant_id)")
    cursor.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_engine_models_default_per_variant
        ON engine_models(variant_id) WHERE is_default = 1
    """)

    # =========================================================================
    # 5. Migrate segments.tts_engine (add :local suffix)
    # =========================================================================
    logger.info("Migration 001: Migrating segments.tts_engine")
    cursor.execute("""
        UPDATE segments
        SET tts_engine = tts_engine || ':local'
        WHERE tts_engine NOT LIKE '%:%'
    """)
    updated_segments = cursor.rowcount
    if updated_segments > 0:
        logger.info(f"Migration 001: Updated {updated_segments} segments with ':local' suffix")

    # =========================================================================
    # 6. Migrate quality_jobs engine fields (if table exists)
    # =========================================================================
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='quality_jobs'")
    if cursor.fetchone():
        logger.info("Migration 001: Migrating quality_jobs engine fields")
        cursor.execute("""
            UPDATE quality_jobs
            SET stt_engine = stt_engine || ':local'
            WHERE stt_engine IS NOT NULL AND stt_engine NOT LIKE '%:%'
        """)
        cursor.execute("""
            UPDATE quality_jobs
            SET audio_engine = audio_engine || ':local'
            WHERE audio_engine IS NOT NULL AND audio_engine NOT LIKE '%:%'
        """)

    # =========================================================================
    # 7. Migrate global_settings engine formats
    # =========================================================================
    logger.info("Migration 001: Migrating global_settings engine formats")
    _migrate_global_settings(cursor)

    # =========================================================================
    # 8. Migrate speaker_samples.file_path (Windows backslash -> forward slash)
    # =========================================================================
    logger.info("Migration 001: Migrating speaker_samples.file_path separators")
    cursor.execute("""
        UPDATE speaker_samples
        SET file_path = REPLACE(file_path, '\\', '/')
        WHERE file_path LIKE '%\\%'
    """)
    updated_samples = cursor.rowcount
    if updated_samples > 0:
        logger.info(f"Migration 001: Fixed path separators in {updated_samples} speaker samples")

    conn.commit()
    logger.success("Migration 001: v1.1.0 Docker Backend migration complete")


def _migrate_global_settings(cursor: sqlite3.Cursor) -> None:
    """
    Migrate global_settings to variant format:
    - Engine keys: "xtts" -> "xtts:local"
    - Default engines: "xtts" -> "xtts:local"
    """
    engine_types = ['tts', 'stt', 'text', 'audio']
    default_keys = {
        'tts': 'defaultTtsEngine',
        'stt': 'defaultSttEngine',
        'text': 'defaultTextEngine',
        'audio': 'defaultAudioEngine',
    }

    for engine_type in engine_types:
        cursor.execute(
            "SELECT value FROM global_settings WHERE key = ?",
            (engine_type,)
        )
        row = cursor.fetchone()
        if not row:
            continue

        try:
            settings = json.loads(row[0])
            modified = False

            # Migrate engines/variants keys
            for key in ['engines', 'variants']:
                if key in settings:
                    old_engines = settings[key]
                    new_engines = {}
                    for engine_name, config in old_engines.items():
                        if ':' not in engine_name:
                            new_engines[f"{engine_name}:local"] = config
                            modified = True
                        else:
                            new_engines[engine_name] = config
                    settings[key] = new_engines

            # Migrate default engine setting
            default_key = default_keys.get(engine_type)
            if default_key and default_key in settings:
                default_engine = settings[default_key]
                if default_engine and ':' not in default_engine:
                    settings[default_key] = f"{default_engine}:local"
                    modified = True

            if modified:
                cursor.execute(
                    "UPDATE global_settings SET value = ? WHERE key = ?",
                    (json.dumps(settings), engine_type)
                )
                logger.info(f"Migration 001: Migrated {engine_type} settings to variant format")

        except (json.JSONDecodeError, KeyError) as e:
            logger.warning(f"Migration 001: Could not migrate {engine_type} settings: {e}")


def downgrade(conn: sqlite3.Connection) -> None:
    """
    Revert migration - remove engine system tables and revert data migrations.

    WARNING: This will lose all Docker/engine configuration data!
    """
    cursor = conn.cursor()

    # Revert segments.tts_engine (remove :local suffix)
    cursor.execute("""
        UPDATE segments
        SET tts_engine = SUBSTR(tts_engine, 1, LENGTH(tts_engine) - 6)
        WHERE tts_engine LIKE '%:local'
    """)

    # Revert quality_jobs engine fields
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='quality_jobs'")
    if cursor.fetchone():
        cursor.execute("""
            UPDATE quality_jobs
            SET stt_engine = SUBSTR(stt_engine, 1, LENGTH(stt_engine) - 6)
            WHERE stt_engine LIKE '%:local'
        """)
        cursor.execute("""
            UPDATE quality_jobs
            SET audio_engine = SUBSTR(audio_engine, 1, LENGTH(audio_engine) - 6)
            WHERE audio_engine LIKE '%:local'
        """)

    # Drop tables in reverse order (respecting foreign keys)
    cursor.execute("DROP TABLE IF EXISTS engine_models")
    cursor.execute("DROP TABLE IF EXISTS engines")
    cursor.execute("DROP TABLE IF EXISTS docker_image_catalog")
    cursor.execute("DROP TABLE IF EXISTS engine_hosts")

    conn.commit()
    logger.info("Migration 001: Downgrade complete - engine system tables removed")
