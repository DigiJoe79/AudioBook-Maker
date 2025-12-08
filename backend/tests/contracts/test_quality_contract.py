"""
Contract Tests for Quality API Endpoints

These tests verify that Quality API responses match expected schemas
and handle validation errors correctly - WITHOUT requiring running engines.
"""

import pytest
from fastapi.testclient import TestClient
from main import app
from models.response_models import QualityJobCreatedResponse

client = TestClient(app)


# ============================================================================
# Test Fixtures - Create test data
# ============================================================================

@pytest.fixture
def test_project():
    """Create a test project and clean up after."""
    response = client.post("/api/projects", json={
        "title": "Quality Contract Test Project",
        "description": "For Quality contract testing"
    })
    assert response.status_code == 200
    project = response.json()

    yield project

    # Cleanup
    client.delete(f"/api/projects/{project['id']}")


@pytest.fixture
def test_chapter(test_project):
    """Create a test chapter."""
    response = client.post("/api/chapters", json={
        "projectId": test_project["id"],
        "title": "Quality Contract Test Chapter",
        "orderIndex": 0,
        "defaultTtsEngine": "xtts",
        "defaultTtsModelName": "v2"
    })
    assert response.status_code == 200
    return response.json()


@pytest.fixture
def test_segment_without_audio(test_chapter):
    """Create a test segment WITHOUT audio."""
    response = client.post("/api/segments", json={
        "chapterId": test_chapter["id"],
        "text": "Segment ohne Audio für Quality Testing.",
        "orderIndex": 0,
        "ttsEngine": "xtts",
        "ttsModelName": "v2",
        "ttsSpeakerName": "test-speaker",
        "language": "de"
    })
    assert response.status_code == 200
    return response.json()


@pytest.fixture
def test_frozen_segment(test_chapter):
    """Create a frozen test segment."""
    # Create segment
    response = client.post("/api/segments", json={
        "chapterId": test_chapter["id"],
        "text": "Frozen Segment.",
        "orderIndex": 1,
        "ttsEngine": "xtts",
        "ttsModelName": "v2",
        "ttsSpeakerName": "test-speaker",
        "language": "de"
    })
    assert response.status_code == 200
    segment = response.json()

    # Freeze it using the dedicated endpoint
    freeze_response = client.patch(
        f"/api/segments/{segment['id']}/freeze",
        json={"freeze": True}
    )
    assert freeze_response.status_code == 200

    return freeze_response.json()


# ============================================================================
# Contract Tests - POST /api/quality/analyze/segment/{segment_id}
# ============================================================================

class TestQualityAnalyzeSegmentContract:
    """Contract tests for POST /api/quality/analyze/segment/{segment_id}."""

    def test_analyze_segment_returns_404_for_unknown(self):
        """Analyze unknown segment returns 404."""
        response = client.post("/api/quality/analyze/segment/nonexistent-id-12345")
        assert response.status_code == 404

        data = response.json()
        assert "detail" in data
        assert "STT_SEGMENT_NOT_FOUND" in data["detail"]

    def test_analyze_segment_returns_400_for_no_audio(self, test_segment_without_audio):
        """Analyze segment without audio returns 400."""
        response = client.post(f"/api/quality/analyze/segment/{test_segment_without_audio['id']}")
        assert response.status_code == 400

        data = response.json()
        assert "detail" in data
        assert "QUALITY_NO_AUDIO" in data["detail"]

    def test_analyze_segment_returns_400_for_frozen(self, test_frozen_segment):
        """Analyze frozen segment returns 400 (frozen check before audio check)."""
        response = client.post(f"/api/quality/analyze/segment/{test_frozen_segment['id']}")
        assert response.status_code == 400

        data = response.json()
        assert "detail" in data
        assert "QUALITY_SEGMENT_FROZEN" in data["detail"]

    def test_analyze_segment_error_uses_error_code_format(self):
        """Error responses use [ERROR_CODE] format for i18n."""
        response = client.post("/api/quality/analyze/segment/nonexistent-id")
        data = response.json()

        # Error code format: [ERROR_CODE]param:value
        assert data["detail"].startswith("[")
        assert "]" in data["detail"]

    def test_analyze_segment_accepts_query_params(self, test_segment_without_audio):
        """Endpoint accepts optional query parameters."""
        response = client.post(
            f"/api/quality/analyze/segment/{test_segment_without_audio['id']}",
            params={
                "stt_engine": "whisper",
                "stt_model_name": "base",
                "audio_engine": "silero-vad"
            }
        )

        # Should fail on no audio, not on invalid params
        assert response.status_code == 400
        assert "QUALITY_NO_AUDIO" in response.json()["detail"]


# ============================================================================
# Contract Tests - POST /api/quality/analyze/chapter/{chapter_id}
# ============================================================================

class TestQualityAnalyzeChapterContract:
    """Contract tests for POST /api/quality/analyze/chapter/{chapter_id}."""

    def test_analyze_chapter_returns_404_for_unknown(self):
        """Analyze unknown chapter returns 404."""
        response = client.post("/api/quality/analyze/chapter/nonexistent-id-12345")
        assert response.status_code == 404

        data = response.json()
        assert "detail" in data
        assert "STT_CHAPTER_NOT_FOUND" in data["detail"]

    def test_analyze_chapter_returns_400_for_no_segments(self, test_chapter):
        """Analyze chapter without completed segments returns 400."""
        response = client.post(f"/api/quality/analyze/chapter/{test_chapter['id']}")
        assert response.status_code == 400

        data = response.json()
        assert "detail" in data
        assert "QUALITY_NO_SEGMENTS" in data["detail"]

    def test_analyze_chapter_error_uses_error_code_format(self):
        """Error responses use [ERROR_CODE] format for i18n."""
        response = client.post("/api/quality/analyze/chapter/nonexistent-id")
        data = response.json()

        # Error code format: [ERROR_CODE]param:value
        assert data["detail"].startswith("[")
        assert "]" in data["detail"]

    def test_analyze_chapter_accepts_query_params(self, test_chapter):
        """Endpoint accepts optional query parameters."""
        response = client.post(
            f"/api/quality/analyze/chapter/{test_chapter['id']}",
            params={
                "stt_engine": "whisper",
                "stt_model_name": "base",
                "audio_engine": "silero-vad"
            }
        )

        # Should fail on no segments, not on invalid params
        assert response.status_code == 400
        assert "QUALITY_NO_SEGMENTS" in response.json()["detail"]


# ============================================================================
# Contract Tests - Response Schema Validation
# ============================================================================

class TestQualityResponseSchemaContract:
    """Contract tests for Quality response schema validation."""

    def test_quality_job_created_response_has_required_fields(self):
        """QualityJobCreatedResponse has required fields."""
        # Test the Pydantic model directly
        response = QualityJobCreatedResponse(
            job_id="test-job-id",
            message="Test message",
            status="pending"
        )

        assert response.job_id == "test-job-id"
        assert response.message == "Test message"
        assert response.status == "pending"

    def test_quality_job_created_response_uses_camel_case(self):
        """QualityJobCreatedResponse serializes to camelCase."""
        response = QualityJobCreatedResponse(
            job_id="test-job-id",
            message="Test message",
            status="pending"
        )

        # model_dump with by_alias=True should produce camelCase
        data = response.model_dump(by_alias=True)

        assert "jobId" in data
        assert "job_id" not in data
        assert "message" in data
        assert "status" in data


# ============================================================================
# Contract Tests - Error Code Format
# ============================================================================

class TestQualityErrorCodeContract:
    """Contract tests for Quality error code format."""

    def test_segment_not_found_error_format(self):
        """Segment not found error includes segment ID."""
        response = client.post("/api/quality/analyze/segment/test-segment-123")

        data = response.json()
        assert "STT_SEGMENT_NOT_FOUND" in data["detail"]
        assert "segmentId:test-segment-123" in data["detail"]

    def test_chapter_not_found_error_format(self):
        """Chapter not found error includes chapter ID."""
        response = client.post("/api/quality/analyze/chapter/test-chapter-456")

        data = response.json()
        assert "STT_CHAPTER_NOT_FOUND" in data["detail"]
        assert "chapterId:test-chapter-456" in data["detail"]
