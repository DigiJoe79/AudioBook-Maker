"""
Database connection and initialization
"""
import sqlite3
from pathlib import Path
from contextlib import contextmanager
from typing import Generator
from loguru import logger

from config import DATABASE_PATH, DATA_DIR

# Schema path - check multiple locations for Docker vs development
# Development: project_root/database/schema.sql (3 levels up from db/database.py)
# Docker: /app/database/schema.sql (2 levels up, since backend/ contents are in /app/)
_schema_candidates = [
    Path(__file__).parent.parent.parent / "database" / "schema.sql",  # Development
    Path(__file__).parent.parent / "database" / "schema.sql",         # Docker container
]
SCHEMA_PATH = next((p for p in _schema_candidates if p.exists()), _schema_candidates[0])
DB_PATH = Path(DATABASE_PATH)
DB_DIR = Path(DATA_DIR)


def _database_has_schema(conn: sqlite3.Connection) -> bool:
    """Check if the database has the required schema tables"""
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'")
    return cursor.fetchone() is not None


def init_database() -> None:
    """Initialize the database with schema if it doesn't exist"""
    # Create data directory if it doesn't exist
    DB_DIR.mkdir(parents=True, exist_ok=True)

    from config import DB_CONNECTION_TIMEOUT
    conn = sqlite3.connect(DB_PATH, timeout=DB_CONNECTION_TIMEOUT)

    try:
        # Use DELETE journal mode (not WAL) for Docker volume mount compatibility
        # This is persisted in the database file, so only needs to be set once
        conn.execute("PRAGMA journal_mode = DELETE")

        # Check if database has schema (not just if file exists)
        # This handles the case where the DB file was created but schema wasn't applied
        if not _database_has_schema(conn):
            logger.info(f"Initializing database schema at {DB_PATH}")
            logger.debug(f"Using schema from: {SCHEMA_PATH}")

            if not SCHEMA_PATH.exists():
                raise FileNotFoundError(f"Schema file not found: {SCHEMA_PATH}")

            with open(SCHEMA_PATH, 'r', encoding='utf-8') as f:
                schema_sql = f.read()

            conn.executescript(schema_sql)
            conn.commit()
            logger.info("Schema applied successfully")
        else:
            logger.debug(f"Using existing database at {DB_PATH}")
            # Note: Schema migrations are handled by migration_runner.py (db/migrations/*.py)

    except Exception as e:
        logger.error(f"Error initializing database: {e}")
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
        conn.execute("PRAGMA journal_mode = DELETE")  # Docker volume mount compatibility
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
    conn.execute("PRAGMA journal_mode = DELETE")  # Docker volume mount compatibility
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
    conn.execute("PRAGMA journal_mode = DELETE")  # Docker volume mount compatibility
    return conn
