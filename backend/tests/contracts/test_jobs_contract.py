"""
Contract Tests for Jobs Endpoints
"""

from fastapi.testclient import TestClient
from main import app
from models.response_models import TTSJobResponse


client = TestClient(app)


class TestTTSJobsListContract:
    """Contract tests for GET /api/jobs/tts."""

    def test_list_tts_jobs_returns_200(self):
        response = client.get("/api/jobs/tts")
        assert response.status_code == 200

    def test_list_tts_jobs_response_structure(self):
        response = client.get("/api/jobs/tts")
        data = response.json()
        # Response structure: {jobs: [], count: int, success: bool}
        assert "jobs" in data
        assert "count" in data
        assert isinstance(data["jobs"], list)

    def test_list_tts_jobs_items_use_camel_case(self):
        response = client.get("/api/jobs/tts")
        jobs = response.json()["jobs"]
        for job in jobs:
            assert "chapter_id" not in job
            TTSJobResponse.model_validate(job)


class TestTTSJobsActiveContract:
    """Contract tests for GET /api/jobs/tts/active."""

    def test_active_jobs_returns_200(self):
        response = client.get("/api/jobs/tts/active")
        assert response.status_code == 200

    def test_active_jobs_response_structure(self):
        data = client.get("/api/jobs/tts/active").json()
        assert "jobs" in data
        assert isinstance(data["jobs"], list)


class TestQualityJobsContract:
    """Contract tests for GET /api/jobs/quality."""

    def test_list_quality_jobs_returns_200(self):
        response = client.get("/api/jobs/quality")
        assert response.status_code == 200

    def test_list_quality_jobs_response_structure(self):
        response = client.get("/api/jobs/quality")
        data = response.json()
        # Response structure: {jobs: [], count: int, success: bool}
        assert "jobs" in data
        assert "count" in data
        assert isinstance(data["jobs"], list)

    def test_active_quality_jobs_returns_200(self):
        response = client.get("/api/jobs/quality/active")
        assert response.status_code == 200

    def test_active_quality_jobs_response_structure(self):
        data = client.get("/api/jobs/quality/active").json()
        assert "jobs" in data
