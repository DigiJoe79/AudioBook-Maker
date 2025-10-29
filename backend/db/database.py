"""
Database connection and initialization
"""
import sqlite3
from pathlib import Path
from contextlib import contextmanager
from typing import Generator
from loguru import logger

from config import DATABASE_PATH, DATA_DIR

SCHEMA_PATH = Path(__file__).parent.parent.parent / "database" / "schema.sql"
DB_PATH = Path(DATABASE_PATH)
DB_DIR = Path(DATA_DIR)


def init_database() -> None:
    """Initialize the database with schema if it doesn't exist"""
    DB_DIR.mkdir(parents=True, exist_ok=True)

    if not DB_PATH.exists():
        logger.info(f"Creating new database at {DB_PATH}")

        conn = sqlite3.connect(DB_PATH)
        try:
            with open(SCHEMA_PATH, 'r', encoding='utf-8') as f:
                schema_sql = f.read()

            conn.executescript(schema_sql)
            conn.commit()
            logger.info("Schema applied successfully")

        except Exception as e:
            logger.error(f"Error applying schema: {e}")
            raise
        finally:
            conn.close()
    else:
        logger.info(f"Using existing database at {DB_PATH}")


@contextmanager
def get_db_connection() -> Generator[sqlite3.Connection, None, None]:
    """
    Context manager for database connections

    Usage:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM projects")
    """
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    except Exception:
        conn.rollback()
        raise
    else:
        conn.commit()
    finally:
        conn.close()


def get_db() -> Generator[sqlite3.Connection, None, None]:
    """
    Get a database connection (for FastAPI dependency injection)

    This is a generator that yields a connection and ensures it's closed after use.
    """
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
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
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn
