"""
Migration: Rename TTS parameters for consistency and Pydantic compliance

This migration renames all TTS-related fields to use consistent 'tts_' prefix:
- model_name → tts_model_name (eliminates Pydantic protected namespace conflict)
- engine → tts_engine (consistency)
- speaker_name → tts_speaker_name (complete consistency)
- default_* variants follow same pattern

Affected tables: chapters, segments, tts_jobs

Date: 2025-01-29
Author: Claude Code
"""

import sqlite3
from loguru import logger


def upgrade(conn: sqlite3.Connection) -> None:
    """Apply migration: Rename all TTS parameters with tts_ prefix"""

    cursor = conn.cursor()
    logger.info("Starting migration 003: Rename TTS parameters")

    # ========== CHAPTERS TABLE ==========
    logger.info("Renaming chapters.default_engine → default_tts_engine")
    cursor.execute("""
        ALTER TABLE chapters RENAME COLUMN default_engine TO default_tts_engine
    """)

    logger.info("Renaming chapters.default_model_name → default_tts_model_name")
    cursor.execute("""
        ALTER TABLE chapters RENAME COLUMN default_model_name TO default_tts_model_name
    """)

    # ========== SEGMENTS TABLE ==========
    logger.info("Renaming segments.engine → tts_engine")
    cursor.execute("""
        ALTER TABLE segments RENAME COLUMN engine TO tts_engine
    """)

    logger.info("Renaming segments.model_name → tts_model_name")
    cursor.execute("""
        ALTER TABLE segments RENAME COLUMN model_name TO tts_model_name
    """)

    logger.info("Renaming segments.speaker_name → tts_speaker_name")
    cursor.execute("""
        ALTER TABLE segments RENAME COLUMN speaker_name TO tts_speaker_name
    """)

    # ========== TTS_JOBS TABLE ==========
    logger.info("Renaming tts_jobs.engine → tts_engine")
    cursor.execute("""
        ALTER TABLE tts_jobs RENAME COLUMN engine TO tts_engine
    """)

    logger.info("Renaming tts_jobs.model_name → tts_model_name")
    cursor.execute("""
        ALTER TABLE tts_jobs RENAME COLUMN model_name TO tts_model_name
    """)

    logger.info("Renaming tts_jobs.speaker_name → tts_speaker_name")
    cursor.execute("""
        ALTER TABLE tts_jobs RENAME COLUMN speaker_name TO tts_speaker_name
    """)

    # ========== UPDATE INDEXES ==========
    # Note: SQLite automatically updates indexes when columns are renamed
    # The existing indexes (idx_segments_engine, idx_segments_speaker) will continue to work
    logger.info("Indexes automatically updated by SQLite")

    conn.commit()
    logger.info("Migration 003 completed successfully - All TTS parameters renamed")


def downgrade(conn: sqlite3.Connection) -> None:
    """Rollback migration: Revert TTS parameter names to original"""

    cursor = conn.cursor()
    logger.info("Rolling back migration 003: Reverting TTS parameter names")

    # ========== CHAPTERS TABLE ==========
    cursor.execute("""
        ALTER TABLE chapters RENAME COLUMN default_tts_engine TO default_engine
    """)

    cursor.execute("""
        ALTER TABLE chapters RENAME COLUMN default_tts_model_name TO default_model_name
    """)

    # ========== SEGMENTS TABLE ==========
    cursor.execute("""
        ALTER TABLE segments RENAME COLUMN tts_engine TO engine
    """)

    cursor.execute("""
        ALTER TABLE segments RENAME COLUMN tts_model_name TO model_name
    """)

    cursor.execute("""
        ALTER TABLE segments RENAME COLUMN tts_speaker_name TO speaker_name
    """)

    # ========== TTS_JOBS TABLE ==========
    cursor.execute("""
        ALTER TABLE tts_jobs RENAME COLUMN tts_engine TO engine
    """)

    cursor.execute("""
        ALTER TABLE tts_jobs RENAME COLUMN tts_model_name TO model_name
    """)

    cursor.execute("""
        ALTER TABLE tts_jobs RENAME COLUMN tts_speaker_name TO speaker_name
    """)

    conn.commit()
    logger.info("Migration 003 rollback complete - Original parameter names restored")


def get_migration_info() -> dict:
    """Get information about this migration"""
    return {
        "version": "003",
        "name": "rename_tts_parameters",
        "description": "Rename all TTS parameters with consistent tts_ prefix for Pydantic compliance",
        "date": "2025-01-29",
        "author": "Claude Code"
    }
