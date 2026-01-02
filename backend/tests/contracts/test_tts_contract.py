"""
Contract Tests for TTS API Endpoints

These tests verify that TTS API responses match expected schemas
and handle validation errors correctly - WITHOUT requiring running engines.
"""

import pytest
from fastapi.testclient import TestClient
from main import app
from models.response_models import ChapterGenerationStartResponse

client = TestClient(app)


# ============================================================================
# Test Fixtures - Create test data
# ============================================================================

@pytest.fixture
def test_project():
    """Create a test project and clean up after."""
    response = client.post("/api/projects", json={
        "title": "TTS Contract Test Project",
        "description": "For TTS contract testing"
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
        "title": "TTS Contract Test Chapter",
        "orderIndex": 0,
        "defaultTtsEngine": "xtts:local",
        "defaultTtsModelName": "v2"
    })
    assert response.status_code == 200
    return response.json()


@pytest.fixture
def test_segment_with_tts_params(test_chapter):
    """Create a test segment with TTS parameters."""
    response = client.post("/api/segments", json={
        "chapterId": test_chapter["id"],
        "text": "Dies ist ein Test-Segment für TTS Contract Testing.",
        "orderIndex": 0,
        "ttsEngine": "xtts:local",
        "ttsModelName": "v2",
        "ttsSpeakerName": "test-speaker",
        "language": "de"
    })
    assert response.status_code == 200
    return response.json()


@pytest.fixture
def test_segment_without_tts_params(test_chapter):
    """Create a test segment WITHOUT TTS parameters (missing speaker)."""
    response = client.post("/api/segments", json={
        "chapterId": test_chapter["id"],
        "text": "Segment ohne TTS Parameter.",
        "orderIndex": 1,
        "ttsEngine": "xtts:local",
        "ttsModelName": "v2",
        "ttsSpeakerName": None,  # Missing speaker
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
        "orderIndex": 2,
        "ttsEngine": "xtts:local",
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
# Contract Tests - POST /api/tts/generate-segment/{segment_id}
# ============================================================================

class TestTTSGenerateSegmentContract:
    """Contract tests for POST /api/tts/generate-segment/{segment_id}."""

    def test_generate_segment_returns_404_for_unknown(self):
        """Generate unknown segment returns 404."""
        response = client.post("/api/tts/generate-segment/nonexistent-id-12345")
        assert response.status_code == 404

        data = response.json()
        assert "detail" in data
        assert "TTS_SEGMENT_NOT_FOUND" in data["detail"]

    def test_generate_segment_returns_400_for_frozen(self, test_frozen_segment):
        """Generate frozen segment returns 400."""
        response = client.post(f"/api/tts/generate-segment/{test_frozen_segment['id']}")
        assert response.status_code == 400

        data = response.json()
        assert "detail" in data
        assert "TTS_SEGMENT_FROZEN" in data["detail"]

    def test_generate_segment_returns_400_for_missing_params(self, test_segment_without_tts_params):
        """Generate segment without TTS parameters returns 400."""
        response = client.post(f"/api/tts/generate-segment/{test_segment_without_tts_params['id']}")
        assert response.status_code == 400

        data = response.json()
        assert "detail" in data
        assert "TTS_MISSING_PARAMETERS" in data["detail"]

    def test_generate_segment_error_uses_error_code_format(self):
        """Error responses use [ERROR_CODE] format for i18n."""
        response = client.post("/api/tts/generate-segment/nonexistent-id")
        data = response.json()

        # Error code format: [ERROR_CODE]param:value
        assert data["detail"].startswith("[")
        assert "]" in data["detail"]


# ============================================================================
# Contract Tests - POST /api/tts/generate-chapter
# ============================================================================

class TestTTSGenerateChapterContract:
    """Contract tests for POST /api/tts/generate-chapter."""

    def test_generate_chapter_returns_422_for_invalid_request(self):
        """Invalid request body returns 422."""
        # Missing required field 'chapterId'
        response = client.post("/api/tts/generate-chapter", json={})
        assert response.status_code == 422

    def test_generate_chapter_returns_422_for_wrong_type(self):
        """Wrong type for field returns 422."""
        response = client.post("/api/tts/generate-chapter", json={
            "chapterId": 12345,  # Should be string
            "forceRegenerate": "yes"  # Should be boolean
        })
        assert response.status_code == 422

    def test_generate_chapter_accepts_camel_case_request(self, test_chapter, test_segment_with_tts_params):
        """Request accepts camelCase field names."""
        # Note: This may return error if no segments, but should not be 422
        response = client.post("/api/tts/generate-chapter", json={
            "chapterId": test_chapter["id"],
            "forceRegenerate": False,
            "overrideSegmentSettings": False
        })

        # Should not be validation error (422)
        assert response.status_code != 422

    def test_generate_chapter_response_uses_camel_case(self, test_chapter, test_segment_with_tts_params):
        """Response uses camelCase field names."""
        response = client.post("/api/tts/generate-chapter", json={
            "chapterId": test_chapter["id"],
            "forceRegenerate": False
        })

        # Skip if engine not available (500)
        if response.status_code == 500:
            pytest.skip("TTS engine not available")

        data = response.json()

        # Response should have camelCase fields
        expected_camel_fields = ["status", "chapterId", "message"]
        for field in expected_camel_fields:
            assert field in data, f"Expected camelCase field '{field}' not found"

        # snake_case should NOT be present
        assert "chapter_id" not in data

    def test_generate_chapter_validates_against_schema(self, test_chapter, test_segment_with_tts_params):
        """Response validates against ChapterGenerationStartResponse."""
        response = client.post("/api/tts/generate-chapter", json={
            "chapterId": test_chapter["id"],
            "forceRegenerate": False
        })

        # Skip if engine not available
        if response.status_code == 500:
            pytest.skip("TTS engine not available")

        data = response.json()

        # Pydantic validation - raises if schema doesn't match
        validated = ChapterGenerationStartResponse.model_validate(data)
        assert validated.chapter_id == test_chapter["id"]
        assert validated.status in ["started", "already_running", "error"]

    def test_generate_chapter_returns_error_for_empty_chapter(self, test_chapter):
        """Generate chapter with no segments returns error status."""
        # Delete any segments first (clean chapter)
        segments_response = client.get(f"/api/chapters/{test_chapter['id']}/segments")
        segments = segments_response.json()
        if isinstance(segments, list):
            for segment in segments:
                client.delete(f"/api/segments/{segment['id']}")

        response = client.post("/api/tts/generate-chapter", json={
            "chapterId": test_chapter["id"],
            "forceRegenerate": False
        })

        # Should return 200 with error status (not 404 or 500)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "error"
        assert "No segments" in data["message"]


# ============================================================================
# Contract Tests - Request Schema Validation
# ============================================================================

class TestTTSRequestSchemaContract:
    """Contract tests for TTS request schema validation."""

    def test_generate_chapter_request_with_all_options(self, test_chapter, test_segment_with_tts_params):
        """Request with all optional fields is accepted."""
        response = client.post("/api/tts/generate-chapter", json={
            "chapterId": test_chapter["id"],
            "forceRegenerate": True,
            "overrideSegmentSettings": True,
            "ttsEngine": "xtts:local",
            "ttsModelName": "v2",
            "ttsSpeakerName": "test-speaker",
            "language": "de",
            "options": {
                "temperature": 0.8,
                "lengthPenalty": 1.0,
                "repetitionPenalty": 2.0,
                "topK": 50,
                "topP": 0.9,
                "speed": 1.0
            }
        })

        # Should not be validation error
        assert response.status_code != 422

    def test_generate_chapter_request_with_snake_case_also_works(self, test_chapter, test_segment_with_tts_params):
        """Request with snake_case fields also works (populate_by_name=True)."""
        response = client.post("/api/tts/generate-chapter", json={
            "chapter_id": test_chapter["id"],
            "force_regenerate": False
        })

        # Should be accepted (not 422)
        assert response.status_code != 422
