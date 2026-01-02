"""Integration tests for Docker image update check endpoint."""
import pytest
import sqlite3
from unittest.mock import patch
from fastapi.testclient import TestClient

from main import app
from db.database import get_db
from db.engine_repository import EngineRepository


@pytest.fixture
def db_conn():
    """Create in-memory database with required tables."""
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Create engine_hosts table (prerequisite)
    cursor.execute("""
        CREATE TABLE engine_hosts (
            host_id TEXT PRIMARY KEY,
            host_type TEXT NOT NULL,
            display_name TEXT NOT NULL,
            ssh_url TEXT,
            is_available BOOLEAN DEFAULT TRUE,
            last_checked_at TEXT,
            docker_volumes TEXT DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    cursor.execute("""
        INSERT INTO engine_hosts (host_id, host_type, display_name)
        VALUES ('local', 'subprocess', 'Local Machine')
    """)
    cursor.execute("""
        INSERT INTO engine_hosts (host_id, host_type, display_name)
        VALUES ('docker:local', 'docker', 'Docker Local')
    """)

    # Create engines table
    cursor.execute("""
        CREATE TABLE engines (
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
            venv_path TEXT,
            server_script TEXT,
            docker_image TEXT,
            docker_tag TEXT DEFAULT 'latest',
            constraints TEXT,
            capabilities TEXT,
            config TEXT,
            config_hash TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (host_id) REFERENCES engine_hosts(host_id)
        )
    """)
    conn.commit()
    yield conn
    conn.close()


@pytest.fixture
def client(db_conn):
    """Create test client with database dependency override."""
    def override_get_db():
        try:
            yield db_conn
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    test_client = TestClient(app)
    yield test_client
    app.dependency_overrides.clear()


class TestCheckDockerImageUpdate:
    """Tests for GET /engines/docker/{variant_id}/check-update"""

    def test_returns_404_for_unknown_variant(self, client: TestClient):
        """Should return 404 if variant doesn't exist."""
        with patch('services.docker_service.is_docker_available', return_value=True):
            response = client.get("/api/engines/docker/nonexistent:docker:local/check-update")
            assert response.status_code == 404

    def test_returns_400_for_non_docker_variant(self, client: TestClient, db_conn):
        """Should return 400 if variant is not a Docker engine."""
        # Insert a subprocess engine (no docker_image)
        repo = EngineRepository(db_conn)
        repo.upsert(
            variant_id="test:local",
            base_engine_name="test",
            engine_type="tts",
            host_id="local",
            source="local",
            is_installed=True,
        )
        db_conn.commit()

        with patch('services.docker_service.is_docker_available', return_value=True):
            response = client.get("/api/engines/docker/test:local/check-update")
            assert response.status_code == 400
            assert "NOT_DOCKER_VARIANT" in response.json()["detail"]

    def test_returns_update_info_for_docker_variant(self, client: TestClient, db_conn):
        """Should return update check result for Docker engine."""
        # Insert a Docker engine
        repo = EngineRepository(db_conn)
        repo.upsert(
            variant_id="xtts:docker:local",
            base_engine_name="xtts",
            engine_type="tts",
            host_id="docker:local",
            source="catalog",
            is_installed=True,
            docker_image="ghcr.io/digijoe79/audiobook-maker-engines/xtts",
            docker_tag="latest",
        )
        db_conn.commit()

        with patch('services.docker_service.is_docker_available', return_value=True), \
             patch('services.docker_service.check_image_update') as mock_check:
            mock_check.return_value = {
                "is_installed": True,
                "update_available": False,
                "local_digest": "sha256:abc123",
                "remote_digest": "sha256:abc123",
                "error": None,
            }

            response = client.get("/api/engines/docker/xtts:docker:local/check-update")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["variantId"] == "xtts:docker:local"
            assert data["updateAvailable"] is False

    def test_returns_docker_unavailable_error(self, client: TestClient):
        """Should handle Docker not being available."""
        with patch('services.docker_service.is_docker_available', return_value=False):
            response = client.get("/api/engines/docker/xtts:docker:local/check-update")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is False
            assert "Docker not available" in data["error"]

    def test_returns_update_available_true(self, client: TestClient, db_conn):
        """Should return updateAvailable=true when digests differ."""
        # Insert a Docker engine
        repo = EngineRepository(db_conn)
        repo.upsert(
            variant_id="xtts:docker:local",
            base_engine_name="xtts",
            engine_type="tts",
            host_id="docker:local",
            source="catalog",
            is_installed=True,
            docker_image="ghcr.io/digijoe79/audiobook-maker-engines/xtts",
            docker_tag="latest",
        )
        db_conn.commit()

        with patch('services.docker_service.is_docker_available', return_value=True), \
             patch('services.docker_service.check_image_update') as mock_check:
            mock_check.return_value = {
                "is_installed": True,
                "update_available": True,
                "local_digest": "sha256:abc123",
                "remote_digest": "sha256:def456",
                "error": None,
            }

            response = client.get("/api/engines/docker/xtts:docker:local/check-update")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["updateAvailable"] is True
            assert data["localDigest"] == "sha256:abc123"
            assert data["remoteDigest"] == "sha256:def456"
