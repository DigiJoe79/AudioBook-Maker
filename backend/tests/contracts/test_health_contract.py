"""
Contract Tests for Health Endpoint

These tests verify that the /health endpoint returns responses
that match the expected HealthResponse schema.
"""

from fastapi.testclient import TestClient
from main import app
from models.response_models import HealthResponse


client = TestClient(app)


class TestHealthContract:
    """Contract tests for /health endpoint."""

    def test_health_returns_200(self):
        """Health endpoint should return 200 OK."""
        response = client.get("/health")
        assert response.status_code == 200

    def test_health_response_validates_against_schema(self):
        """Response should validate against HealthResponse Pydantic model."""
        response = client.get("/health")
        data = response.json()

        # Pydantic validation - raises if schema doesn't match
        validated = HealthResponse.model_validate(data)

        # Basic assertions
        assert validated.status in ["ok", "degraded", "down"]
        assert isinstance(validated.version, str)
        assert isinstance(validated.database, bool)

    def test_health_response_uses_camel_case(self):
        """Response should use camelCase field names."""
        response = client.get("/health")
        data = response.json()

        # These fields should be camelCase in JSON
        expected_camel_fields = [
            "status",
            "version",
            "timestamp",
            "database",
            "ttsEngines",  # snake_case: tts_engines
            "busy",
            "activeJobs",  # snake_case: active_jobs
        ]

        for field in expected_camel_fields:
            assert field in data, f"Expected camelCase field '{field}' not found in response"

        # These snake_case fields should NOT be present
        snake_case_fields = ["tts_engines", "active_jobs", "has_tts_engine"]
        for field in snake_case_fields:
            assert field not in data, f"Unexpected snake_case field '{field}' found in response"

    def test_health_response_required_fields(self):
        """Response should contain all required fields."""
        response = client.get("/health")
        data = response.json()

        required_fields = ["status", "version", "timestamp", "database"]
        for field in required_fields:
            assert field in data, f"Required field '{field}' missing from response"

    def test_health_response_types(self):
        """Response fields should have correct types."""
        response = client.get("/health")
        data = response.json()

        assert isinstance(data["status"], str)
        assert isinstance(data["version"], str)
        assert isinstance(data["timestamp"], str)
        assert isinstance(data["database"], bool)
        assert isinstance(data.get("ttsEngines", []), list)
        assert isinstance(data.get("busy", False), bool)
        assert isinstance(data.get("activeJobs", 0), int)
