"""
Migration: Update global_settings JSON keys to match new tts_ prefix convention

This migration updates the JSON values in the global_settings table to match
the new naming convention established in migration 003:
- defaultEngine → defaultTtsEngine
- defaultModelName → defaultTtsModelName
- defaultSpeaker → defaultTtsSpeaker

Unlike migration 003 which renamed table columns, this migration updates
the JSON values stored in the 'value' column of the global_settings table.

Date: 2025-11-02
Author: Claude Code
"""

import sqlite3
import json
from loguru import logger


def upgrade(conn: sqlite3.Connection) -> None:
    """Apply migration: Rename keys in global_settings JSON values"""

    cursor = conn.cursor()
    logger.info("Starting migration 004: Update global_settings JSON keys")

    # ========== UPDATE TTS SETTINGS ==========
    logger.info("Checking for 'tts' settings in global_settings")

    # Get current tts settings
    cursor.execute("SELECT key, value FROM global_settings WHERE key = 'tts'")
    row = cursor.fetchone()

    if row:
        key, value_json = row
        tts_settings = json.loads(value_json)

        # Check if old keys exist and rename them
        renamed = False

        if 'defaultEngine' in tts_settings:
            tts_settings['defaultTtsEngine'] = tts_settings.pop('defaultEngine')
            renamed = True
            logger.info("  Renamed: defaultEngine → defaultTtsEngine")

        if 'defaultModelName' in tts_settings:
            tts_settings['defaultTtsModelName'] = tts_settings.pop('defaultModelName')
            renamed = True
            logger.info("  Renamed: defaultModelName → defaultTtsModelName")

        if 'defaultSpeaker' in tts_settings:
            tts_settings['defaultTtsSpeaker'] = tts_settings.pop('defaultSpeaker')
            renamed = True
            logger.info("  Renamed: defaultSpeaker → defaultTtsSpeaker")

        # Update the database if any keys were renamed
        if renamed:
            cursor.execute(
                "UPDATE global_settings SET value = ? WHERE key = 'tts'",
                (json.dumps(tts_settings),)
            )
            logger.info("  Updated 'tts' settings in database")
        else:
            logger.info("  No old keys found - settings already up to date")
    else:
        logger.warning("  No 'tts' settings found in global_settings table")

    conn.commit()
    logger.info("Migration 004 completed successfully - global_settings JSON keys updated")


def downgrade(conn: sqlite3.Connection) -> None:
    """Rollback migration: Revert JSON keys to original names"""

    cursor = conn.cursor()
    logger.info("Rolling back migration 004: Reverting global_settings JSON keys")

    # ========== REVERT TTS SETTINGS ==========
    cursor.execute("SELECT key, value FROM global_settings WHERE key = 'tts'")
    row = cursor.fetchone()

    if row:
        key, value_json = row
        tts_settings = json.loads(value_json)

        # Revert key names
        if 'defaultTtsEngine' in tts_settings:
            tts_settings['defaultEngine'] = tts_settings.pop('defaultTtsEngine')

        if 'defaultTtsModelName' in tts_settings:
            tts_settings['defaultModelName'] = tts_settings.pop('defaultTtsModelName')

        if 'defaultTtsSpeaker' in tts_settings:
            tts_settings['defaultSpeaker'] = tts_settings.pop('defaultTtsSpeaker')

        # Update the database
        cursor.execute(
            "UPDATE global_settings SET value = ? WHERE key = 'tts'",
            (json.dumps(tts_settings),)
        )

    conn.commit()
    logger.info("Migration 004 rollback complete - Original JSON keys restored")


def get_migration_info() -> dict:
    """Get information about this migration"""
    return {
        "version": "004",
        "name": "rename_global_settings_keys",
        "description": "Update global_settings JSON keys to match new tts_ prefix convention",
        "date": "2025-11-02",
        "author": "Claude Code"
    }
