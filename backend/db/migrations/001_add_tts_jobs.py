"""
Migration: Add tts_jobs table for persistent job queue

This migration adds the tts_jobs table to support persistent TTS generation jobs.
Jobs will survive backend restarts and enable better monitoring and recovery.

Date: 2025-10-31
"""

import sqlite3
from datetime import datetime
from loguru import logger


def upgrade(conn: sqlite3.Connection) -> None:
    """Add tts_jobs table and related indexes"""

    cursor = conn.cursor()

    # Create tts_jobs table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tts_jobs (
            id TEXT PRIMARY KEY,
            chapter_id TEXT NOT NULL,

            -- Engine Configuration
            engine TEXT NOT NULL,
            model_name TEXT NOT NULL,
            speaker_name TEXT NOT NULL,
            language TEXT NOT NULL,
            force_regenerate BOOLEAN DEFAULT FALSE,

            -- Job Status & Progress
            status TEXT NOT NULL DEFAULT 'pending',
            total_segments INTEGER NOT NULL,
            processed_segments INTEGER DEFAULT 0,
            failed_segments INTEGER DEFAULT 0,
            current_segment_id TEXT,

            -- Error Handling
            error_message TEXT,
            retry_count INTEGER DEFAULT 0,

            -- Timestamps
            created_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            updated_at TEXT NOT NULL,

            FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
        )
    """)

    # Create indexes for performance
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_tts_jobs_status
        ON tts_jobs(status)
    """)

    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_tts_jobs_chapter
        ON tts_jobs(chapter_id)
    """)

    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_tts_jobs_created
        ON tts_jobs(created_at)
    """)

    # Reset any stuck jobs from previous session (safety measure)
    # This handles the case where the migration is run with existing stuck jobs
    cursor.execute("""
        UPDATE tts_jobs
        SET status = 'failed',
            error_message = 'Migration: Server restart detected - job interrupted',
            updated_at = ?
        WHERE status = 'running'
    """, (datetime.now().isoformat(),))

    affected_rows = cursor.rowcount
    if affected_rows > 0:
        logger.warning(f"Migration: Reset {affected_rows} stuck jobs from previous session")

    conn.commit()
    logger.info("Migration complete: tts_jobs table created successfully")


def downgrade(conn: sqlite3.Connection) -> None:
    """Remove tts_jobs table and indexes"""

    cursor = conn.cursor()

    # Drop indexes
    cursor.execute("DROP INDEX IF EXISTS idx_tts_jobs_status")
    cursor.execute("DROP INDEX IF EXISTS idx_tts_jobs_chapter")
    cursor.execute("DROP INDEX IF EXISTS idx_tts_jobs_created")

    # Drop table
    cursor.execute("DROP TABLE IF EXISTS tts_jobs")

    conn.commit()
    logger.info("Migration rollback: tts_jobs table removed")


def get_migration_info() -> dict:
    """Get information about this migration"""
    return {
        "version": "001",
        "name": "add_tts_jobs",
        "description": "Add tts_jobs table for persistent job queue",
        "date": "2025-10-31",
        "author": "System"
    }