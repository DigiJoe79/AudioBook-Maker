"""
Database connection and initialization
"""
import sqlite3
from pathlib import Path
from contextlib import contextmanager
from typing import Generator
from loguru import logger

from config import DATABASE_PATH, DATA_DIR

# Schema path (relative to project root)
SCHEMA_PATH = Path(__file__).parent.parent.parent / "database" / "schema.sql"
DB_PATH = Path(DATABASE_PATH)
DB_DIR = Path(DATA_DIR)


def _apply_migrations(conn: sqlite3.Connection) -> None:
    """Apply database migrations for existing databases"""
    cursor = conn.cursor()

    # Check if is_frozen column exists in segments table
    cursor.execute("PRAGMA table_info(segments)")
    columns = [col[1] for col in cursor.fetchall()]

    if 'is_frozen' not in columns:
        logger.info("Applying migration: Adding is_frozen column to segments table")
        cursor.execute("ALTER TABLE segments ADD COLUMN is_frozen BOOLEAN DEFAULT FALSE")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_segments_frozen ON segments(is_frozen)")
        conn.commit()
        logger.info("Migration applied successfully: is_frozen column added")

    # Migration: Remove default_tts_engine and default_tts_model_name from chapters table
    # SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
    cursor.execute("PRAGMA table_info(chapters)")
    chapter_columns = [col[1] for col in cursor.fetchall()]

    if 'default_tts_engine' in chapter_columns or 'default_tts_model_name' in chapter_columns:
        logger.info("Applying migration: Removing default_tts_engine and default_tts_model_name from chapters table")

        # Create new chapters table without the unused columns
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS chapters_new (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                title TEXT NOT NULL,
                order_index INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            )
        """)

        # Copy data from old table to new table
        cursor.execute("""
            INSERT INTO chapters_new (id, project_id, title, order_index, created_at, updated_at)
            SELECT id, project_id, title, order_index, created_at, updated_at
            FROM chapters
        """)

        # Drop old table
        cursor.execute("DROP TABLE chapters")

        # Rename new table to original name
        cursor.execute("ALTER TABLE chapters_new RENAME TO chapters")

        # Recreate index
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_chapters_project ON chapters(project_id)")

        conn.commit()
        logger.info("Migration applied successfully: default_tts_engine and default_tts_model_name columns removed")


def init_database() -> None:
    """Initialize the database with schema if it doesn't exist"""
    # Create data directory if it doesn't exist
    DB_DIR.mkdir(parents=True, exist_ok=True)

    # Check if database exists
    if not DB_PATH.exists():
        logger.info(f"Creating new database at {DB_PATH}")

        # Create database and apply schema
        from config import DB_CONNECTION_TIMEOUT
        conn = sqlite3.connect(DB_PATH, timeout=DB_CONNECTION_TIMEOUT)
        try:
            # Enable WAL mode immediately for new databases
            conn.execute("PRAGMA journal_mode = WAL")

            with open(SCHEMA_PATH, 'r', encoding='utf-8') as f:
                schema_sql = f.read()

            conn.executescript(schema_sql)
            conn.commit()
            logger.info("Schema applied successfully (WAL mode enabled)")

        except Exception as e:
            logger.error(f"Error applying schema: {e}")
            raise
        finally:
            conn.close()
    else:
        logger.debug(f"Using existing database at {DB_PATH}")

        # Apply migrations for existing databases
        from config import DB_CONNECTION_TIMEOUT
        conn = sqlite3.connect(DB_PATH, timeout=DB_CONNECTION_TIMEOUT)
        try:
            # Enable WAL mode for existing databases
            conn.execute("PRAGMA journal_mode = WAL")
            _apply_migrations(conn)
        except Exception as e:
            logger.error(f"Error applying migrations: {e}")
            raise
        finally:
            conn.close()


@contextmanager
def get_db_connection() -> Generator[sqlite3.Connection, None, None]:
    """
    Get a database connection with proper cleanup.

    Automatically rolls back on exception and ensures connection is closed.

    Usage:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM projects")
    """
    conn = None
    try:
        from config import DB_CONNECTION_TIMEOUT
        conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=DB_CONNECTION_TIMEOUT)
        conn.row_factory = sqlite3.Row  # Enable row access by column name
        conn.execute("PRAGMA foreign_keys = ON")  # Enable foreign key constraints
        conn.execute("PRAGMA journal_mode = WAL")  # Enable WAL mode for better concurrency
        yield conn
    except Exception:
        if conn:
            try:
                conn.rollback()
            except Exception as rollback_error:
                logger.warning(f"Error during rollback: {rollback_error}")
        raise
    else:
        if conn:
            conn.commit()
    finally:
        if conn:
            try:
                conn.close()
            except Exception as close_error:
                logger.warning(f"Error closing DB connection: {close_error}")


def get_db() -> Generator[sqlite3.Connection, None, None]:
    """
    Get a database connection (for FastAPI dependency injection)

    This is a generator that yields a connection and ensures it's closed after use.
    """
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")  # Enable foreign key constraints
    conn.execute("PRAGMA journal_mode = WAL")  # Enable WAL mode for better concurrency
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_db_connection_simple() -> sqlite3.Connection:
    """Get a simple database connection (not a context manager)"""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")  # Enable foreign key constraints
    conn.execute("PRAGMA journal_mode = WAL")  # Enable WAL mode for better concurrency
    return conn
