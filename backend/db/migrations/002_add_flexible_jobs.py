"""
Migration: Add segment-based job tracking and cancellation support

This migration extends tts_jobs table to support:
- Segment-level tracking with job_status per segment
- Job cancellation with graceful shutdown

Changes:
- Add segment_ids TEXT column (JSON array of segment objects with job_status)
- Extend status values to include 'cancelling' state

Date: 2025-11-01
"""

import sqlite3
from loguru import logger


def upgrade(conn: sqlite3.Connection) -> None:
    """Add segment-based job tracking"""

    cursor = conn.cursor()

    # Check if segment_ids already exists (prevents duplicate column error)
    cursor.execute("PRAGMA table_info(tts_jobs)")
    columns = [row[1] for row in cursor.fetchall()]

    if 'segment_ids' in columns:
        logger.info("segment_ids column already exists, skipping migration")
        return

    # Add segment_ids column (JSON array of segment objects)
    # Each object contains: {"id": "segment-uuid", "job_status": "pending|completed"}
    cursor.execute("""
        ALTER TABLE tts_jobs
        ADD COLUMN segment_ids TEXT DEFAULT NULL
    """)
    logger.info("Added segment_ids column to tts_jobs")

    conn.commit()
    logger.success("Migration complete: Segment-based job tracking enabled")


def downgrade(conn: sqlite3.Connection) -> None:
    """Remove segment-based job tracking"""

    cursor = conn.cursor()

    # Note: SQLite doesn't support DROP COLUMN directly
    # This is a simplified rollback that doesn't remove columns
    # For production, you'd need to recreate the table

    logger.warning("SQLite doesn't support DROP COLUMN - segment_ids column will remain but be unused")

    # Reset segment_ids to NULL (effectively disabling feature)
    cursor.execute("""
        UPDATE tts_jobs
        SET segment_ids = NULL
        WHERE 1=1
    """)

    conn.commit()
    logger.info("Migration rollback: Segment-based tracking disabled (column remains)")


def get_migration_info() -> dict:
    """Get information about this migration"""
    return {
        "version": "002",
        "name": "add_segment_tracking",
        "description": "Add segment-based job tracking with job_status per segment",
        "date": "2025-11-01",
        "author": "System"
    }
