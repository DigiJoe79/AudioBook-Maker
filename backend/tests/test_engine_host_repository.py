"""Tests for EngineHostRepository."""
import sqlite3
import pytest
from db.engine_host_repository import EngineHostRepository


@pytest.fixture
def repo():
    """Create in-memory database with repository."""
    conn = sqlite3.connect(':memory:')
    conn.row_factory = sqlite3.Row

    # Create schema
    conn.execute("""
        CREATE TABLE engine_hosts (
            host_id TEXT PRIMARY KEY,
            host_type TEXT NOT NULL,
            display_name TEXT NOT NULL,
            ssh_url TEXT,
            is_available INTEGER DEFAULT 0,
            docker_volumes TEXT,
            created_at TEXT,
            last_checked_at TEXT
        )
    """)
    conn.commit()

    return EngineHostRepository(conn)


def test_is_host_available_returns_true_when_available(repo):
    """is_host_available returns True for available hosts."""
    repo.create('docker:local', 'docker:local', 'Docker Local')
    repo.set_available('docker:local', True)

    assert repo.is_host_available('docker:local') is True


def test_is_host_available_returns_false_when_unavailable(repo):
    """is_host_available returns False for unavailable hosts."""
    repo.create('docker:local', 'docker:local', 'Docker Local')
    repo.set_available('docker:local', False)

    assert repo.is_host_available('docker:local') is False


def test_is_host_available_returns_false_for_unknown_host(repo):
    """is_host_available returns False for non-existent hosts."""
    assert repo.is_host_available('docker:unknown') is False


def test_is_host_available_subprocess_always_true(repo):
    """Subprocess host is always available (local execution)."""
    repo.create('local', 'subprocess', 'Local Machine')

    # Subprocess hosts are created with is_available=True
    assert repo.is_host_available('local') is True
