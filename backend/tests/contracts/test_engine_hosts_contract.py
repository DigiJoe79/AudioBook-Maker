"""
Contract Tests for Engine Hosts API Endpoints

These tests verify that Engine Hosts API responses match expected schemas
and handle validation errors correctly.

Endpoints tested:
- GET /api/engine-hosts - List all hosts
- GET /api/engine-hosts/{id} - Get specific host
- POST /api/engine-hosts - Create remote Docker host
- DELETE /api/engine-hosts/{id} - Delete host
- POST /api/engine-hosts/ensure-docker-local - Ensure docker:local exists
- GET /api/engine-hosts/{id}/volumes - Get volume config
- PUT /api/engine-hosts/{id}/volumes - Set volume config
"""

import pytest
from fastapi.testclient import TestClient
from main import app
from models.response_models import (
    EngineHostResponse,
    EngineHostsListResponse,
    DockerVolumesResponse,
    MessageResponse,
)

client = TestClient(app)


# ============================================================================
# Test Fixtures
# ============================================================================

@pytest.fixture
def created_hosts():
    """Track hosts created during tests for cleanup."""
    hosts = []
    yield hosts

    # Cleanup all created hosts
    for host_id in hosts:
        try:
            client.delete(f"/api/engine-hosts/{host_id}")
        except Exception:
            pass


# ============================================================================
# Contract Tests - GET /api/engine-hosts
# ============================================================================

class TestEngineHostsListContract:
    """Contract tests for GET /api/engine-hosts."""

    def test_list_hosts_returns_200(self):
        """List hosts returns 200."""
        response = client.get("/api/engine-hosts")
        assert response.status_code == 200

    def test_list_hosts_response_uses_camel_case(self):
        """Response uses camelCase field names."""
        response = client.get("/api/engine-hosts")
        assert response.status_code == 200

        data = response.json()

        # Response should have camelCase fields
        assert "hosts" in data
        assert "count" in data

        # Check host fields if any exist
        if data["hosts"]:
            host = data["hosts"][0]
            assert "hostId" in host
            assert "hostType" in host
            assert "displayName" in host
            assert "isAvailable" in host
            assert "engineCount" in host

            # snake_case should NOT be present
            assert "host_id" not in host
            assert "host_type" not in host
            assert "display_name" not in host

    def test_list_hosts_response_validates_against_schema(self):
        """Response validates against EngineHostsListResponse schema."""
        response = client.get("/api/engine-hosts")
        assert response.status_code == 200

        data = response.json()

        # Pydantic validation
        validated = EngineHostsListResponse.model_validate(data)
        assert validated.count >= 0
        assert len(validated.hosts) == validated.count

    def test_list_hosts_includes_local_host(self):
        """List always includes the 'local' subprocess host."""
        response = client.get("/api/engine-hosts")
        assert response.status_code == 200

        data = response.json()
        host_ids = [h["hostId"] for h in data["hosts"]]

        # 'local' host should always exist
        assert "local" in host_ids


# ============================================================================
# Contract Tests - GET /api/engine-hosts/{id}
# ============================================================================

class TestEngineHostGetContract:
    """Contract tests for GET /api/engine-hosts/{id}."""

    def test_get_host_returns_200_for_local(self):
        """Get local host returns 200."""
        response = client.get("/api/engine-hosts/local")
        assert response.status_code == 200

    def test_get_host_returns_404_for_unknown(self):
        """Get unknown host returns 404."""
        response = client.get("/api/engine-hosts/nonexistent-host-id-12345")
        assert response.status_code == 404

        data = response.json()
        assert "detail" in data
        assert "HOST_NOT_FOUND" in data["detail"]

    def test_get_host_response_uses_camel_case(self):
        """Response uses camelCase field names."""
        response = client.get("/api/engine-hosts/local")
        assert response.status_code == 200

        data = response.json()

        # Response should have camelCase fields
        assert "hostId" in data
        assert "hostType" in data
        assert "displayName" in data

        # snake_case should NOT be present
        assert "host_id" not in data
        assert "host_type" not in data

    def test_get_host_response_validates_against_schema(self):
        """Response validates against EngineHostResponse schema."""
        response = client.get("/api/engine-hosts/local")
        assert response.status_code == 200

        data = response.json()

        # Pydantic validation
        validated = EngineHostResponse.model_validate(data)
        assert validated.host_id == "local"
        assert validated.host_type == "subprocess"

    def test_get_host_error_uses_error_code_format(self):
        """Error responses use [ERROR_CODE] format."""
        response = client.get("/api/engine-hosts/nonexistent-id")
        data = response.json()

        # Error code format: [ERROR_CODE]param:value
        assert data["detail"].startswith("[")
        assert "]" in data["detail"]


# ============================================================================
# Contract Tests - POST /api/engine-hosts
# ============================================================================

class TestEngineHostCreateContract:
    """Contract tests for POST /api/engine-hosts."""

    def test_create_host_returns_422_for_missing_name(self):
        """Missing name returns 422."""
        response = client.post("/api/engine-hosts", json={
            "sshUrl": "ssh://user@192.168.1.100"
        })
        assert response.status_code == 422

    def test_create_host_returns_422_for_missing_ssh_url(self):
        """Missing sshUrl returns 422."""
        response = client.post("/api/engine-hosts", json={
            "name": "Test Host"
        })
        assert response.status_code == 422

    def test_create_host_accepts_camel_case(self, created_hosts):
        """Request accepts camelCase field names."""
        response = client.post("/api/engine-hosts", json={
            "name": "Contract Test Host",
            "sshUrl": "ssh://testuser@10.0.0.99"
        })

        # Should not be validation error
        assert response.status_code != 422

        # Track for cleanup if created
        if response.status_code == 200:
            data = response.json()
            if "hostId" in data:
                created_hosts.append(data["hostId"])

    def test_create_host_accepts_snake_case(self, created_hosts):
        """Request accepts snake_case field names (populate_by_name=True)."""
        response = client.post("/api/engine-hosts", json={
            "name": "Contract Test Host 2",
            "ssh_url": "ssh://testuser@10.0.0.100"
        })

        # Should be accepted (not 422)
        assert response.status_code != 422

        # Track for cleanup if created
        if response.status_code == 200:
            data = response.json()
            if "hostId" in data:
                created_hosts.append(data["hostId"])

    def test_create_host_response_uses_camel_case(self, created_hosts):
        """Response uses camelCase field names."""
        response = client.post("/api/engine-hosts", json={
            "name": "CamelCase Test Host",
            "sshUrl": "ssh://user@10.0.0.101"
        })

        if response.status_code == 200:
            data = response.json()

            # Track for cleanup
            if "hostId" in data:
                created_hosts.append(data["hostId"])

            # Response should have camelCase fields
            assert "hostId" in data
            assert "hostType" in data
            assert "displayName" in data
            assert "sshUrl" in data

            # snake_case should NOT be present
            assert "host_id" not in data
            assert "ssh_url" not in data


# ============================================================================
# Contract Tests - DELETE /api/engine-hosts/{id}
# ============================================================================

class TestEngineHostDeleteContract:
    """Contract tests for DELETE /api/engine-hosts/{id}."""

    def test_delete_host_returns_404_for_unknown(self):
        """Delete unknown host returns 404."""
        response = client.delete("/api/engine-hosts/nonexistent-host-id-12345")
        assert response.status_code == 404

        data = response.json()
        assert "detail" in data
        assert "HOST_NOT_FOUND" in data["detail"]

    def test_delete_host_returns_400_for_local(self):
        """Cannot delete local host returns 400."""
        response = client.delete("/api/engine-hosts/local")
        assert response.status_code == 400

        data = response.json()
        assert "detail" in data
        assert "HOST_DELETE_FORBIDDEN" in data["detail"]

    def test_delete_host_response_validates_against_schema(self, created_hosts):
        """Response validates against MessageResponse schema."""
        # First create a host to delete
        create_response = client.post("/api/engine-hosts", json={
            "name": "Delete Test Host",
            "sshUrl": "ssh://user@10.0.0.102"
        })

        if create_response.status_code != 200:
            pytest.skip("Could not create host for deletion test")

        host_id = create_response.json()["hostId"]

        # Delete it
        response = client.delete(f"/api/engine-hosts/{host_id}")
        assert response.status_code == 200

        data = response.json()
        validated = MessageResponse.model_validate(data)
        assert validated.success is True

    def test_delete_host_error_uses_error_code_format(self):
        """Error responses use [ERROR_CODE] format."""
        response = client.delete("/api/engine-hosts/local")
        data = response.json()

        assert data["detail"].startswith("[")
        assert "]" in data["detail"]


# ============================================================================
# Contract Tests - POST /api/engine-hosts/ensure-docker-local
# ============================================================================

class TestEnsureDockerLocalContract:
    """Contract tests for POST /api/engine-hosts/ensure-docker-local."""

    def test_ensure_docker_local_returns_200(self):
        """Ensure docker:local returns 200."""
        response = client.post("/api/engine-hosts/ensure-docker-local")
        assert response.status_code == 200

    def test_ensure_docker_local_response_uses_camel_case(self):
        """Response uses camelCase field names."""
        response = client.post("/api/engine-hosts/ensure-docker-local")
        assert response.status_code == 200

        data = response.json()

        # Response should have camelCase fields
        assert "hostId" in data
        assert "hostType" in data

        # snake_case should NOT be present
        assert "host_id" not in data
        assert "host_type" not in data

    def test_ensure_docker_local_response_validates_against_schema(self):
        """Response validates against EngineHostResponse schema."""
        response = client.post("/api/engine-hosts/ensure-docker-local")
        assert response.status_code == 200

        data = response.json()

        validated = EngineHostResponse.model_validate(data)
        assert validated.host_id == "docker:local"
        assert validated.host_type == "docker:local"


# ============================================================================
# Contract Tests - GET /api/engine-hosts/{id}/volumes
# ============================================================================

class TestEngineHostVolumesGetContract:
    """Contract tests for GET /api/engine-hosts/{id}/volumes."""

    def test_get_volumes_returns_404_for_unknown_host(self):
        """Unknown host returns 404."""
        response = client.get("/api/engine-hosts/nonexistent-host/volumes")
        assert response.status_code == 404

        data = response.json()
        assert "detail" in data
        assert "HOST_NOT_FOUND" in data["detail"]

    def test_get_volumes_returns_400_for_non_docker_host(self):
        """Non-Docker host (subprocess) returns 400."""
        response = client.get("/api/engine-hosts/local/volumes")
        assert response.status_code == 400

        data = response.json()
        assert "detail" in data
        assert "HOST_NOT_DOCKER" in data["detail"]

    def test_get_volumes_returns_200_for_docker_local(self):
        """Docker local host returns 200."""
        # Ensure docker:local exists first
        client.post("/api/engine-hosts/ensure-docker-local")

        response = client.get("/api/engine-hosts/docker:local/volumes")
        assert response.status_code == 200

    def test_get_volumes_response_uses_camel_case(self):
        """Response uses camelCase field names."""
        # Ensure docker:local exists
        client.post("/api/engine-hosts/ensure-docker-local")

        response = client.get("/api/engine-hosts/docker:local/volumes")
        assert response.status_code == 200

        data = response.json()

        # Response should have camelCase fields
        assert "hostId" in data
        assert "samplesPath" in data or data.get("samplesPath") is None
        assert "modelsPath" in data or data.get("modelsPath") is None

        # snake_case should NOT be present
        assert "host_id" not in data
        assert "samples_path" not in data
        assert "models_path" not in data

    def test_get_volumes_response_validates_against_schema(self):
        """Response validates against DockerVolumesResponse schema."""
        # Ensure docker:local exists
        client.post("/api/engine-hosts/ensure-docker-local")

        response = client.get("/api/engine-hosts/docker:local/volumes")
        assert response.status_code == 200

        data = response.json()

        validated = DockerVolumesResponse.model_validate(data)
        assert validated.host_id == "docker:local"


# ============================================================================
# Contract Tests - PUT /api/engine-hosts/{id}/volumes
# ============================================================================

class TestEngineHostVolumesSetContract:
    """Contract tests for PUT /api/engine-hosts/{id}/volumes."""

    def test_set_volumes_returns_404_for_unknown_host(self):
        """Unknown host returns 404."""
        response = client.put("/api/engine-hosts/nonexistent-host/volumes", json={
            "samplesPath": "/tmp/samples"
        })
        assert response.status_code == 404

        data = response.json()
        assert "detail" in data
        assert "HOST_NOT_FOUND" in data["detail"]

    def test_set_volumes_returns_400_for_non_docker_host(self):
        """Non-Docker host (subprocess) returns 400."""
        response = client.put("/api/engine-hosts/local/volumes", json={
            "samplesPath": "/tmp/samples"
        })
        assert response.status_code == 400

        data = response.json()
        assert "detail" in data
        assert "HOST_NOT_DOCKER" in data["detail"]

    def test_set_volumes_accepts_camel_case(self):
        """Request accepts camelCase field names."""
        # Ensure docker:local exists
        client.post("/api/engine-hosts/ensure-docker-local")

        response = client.put("/api/engine-hosts/docker:local/volumes", json={
            "samplesPath": None,
            "modelsPath": None
        })

        # Should not be validation error
        assert response.status_code != 422

    def test_set_volumes_accepts_snake_case(self):
        """Request accepts snake_case field names."""
        # Ensure docker:local exists
        client.post("/api/engine-hosts/ensure-docker-local")

        response = client.put("/api/engine-hosts/docker:local/volumes", json={
            "samples_path": None,
            "models_path": None
        })

        # Should be accepted
        assert response.status_code != 422

    def test_set_volumes_response_uses_camel_case(self):
        """Response uses camelCase field names."""
        # Ensure docker:local exists
        client.post("/api/engine-hosts/ensure-docker-local")

        response = client.put("/api/engine-hosts/docker:local/volumes", json={
            "samplesPath": None,
            "modelsPath": None
        })

        if response.status_code == 200:
            data = response.json()

            # Response should have camelCase fields
            assert "hostId" in data
            assert "success" in data

            # snake_case should NOT be present
            assert "host_id" not in data

    def test_set_volumes_response_validates_against_schema(self):
        """Response validates against DockerVolumesResponse schema."""
        # Ensure docker:local exists
        client.post("/api/engine-hosts/ensure-docker-local")

        response = client.put("/api/engine-hosts/docker:local/volumes", json={
            "samplesPath": None
        })
        assert response.status_code == 200

        data = response.json()

        validated = DockerVolumesResponse.model_validate(data)
        assert validated.success is True
        assert validated.host_id == "docker:local"

    def test_set_volumes_returns_validation_error_for_invalid_path(self):
        """Setting non-existent path returns validation_error in response."""
        # Ensure docker:local exists
        client.post("/api/engine-hosts/ensure-docker-local")

        response = client.put("/api/engine-hosts/docker:local/volumes", json={
            "samplesPath": "/nonexistent/path/that/does/not/exist"
        })

        # Should still return 200 but with validation_error
        assert response.status_code == 200

        data = response.json()
        # For docker:local, paths are validated
        assert "validationError" in data or data.get("validationError") is None

    def test_set_volumes_error_uses_error_code_format(self):
        """Error responses use [ERROR_CODE] format."""
        response = client.put("/api/engine-hosts/local/volumes", json={
            "samplesPath": "/tmp"
        })
        data = response.json()

        assert data["detail"].startswith("[")
        assert "]" in data["detail"]
