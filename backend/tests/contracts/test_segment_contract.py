"""
Contract Tests for Segment Endpoints

These tests verify that segment API responses match expected schemas
and behaviors defined in the SegmentResponse model.
"""

import pytest
from fastapi.testclient import TestClient
from main import app
from models.response_models import SegmentResponse, DeleteResponse


client = TestClient(app)


# ============================================================================
# Test Fixtures - Create test data
# ============================================================================

@pytest.fixture
def test_project():
    """Create a test project and clean up after."""
    response = client.post("/api/projects", json={
        "title": "Contract Test Project",
        "description": "For contract testing"
    })
    assert response.status_code == 200
    project = response.json()

    yield project

    # Cleanup
    client.delete(f"/api/projects/{project['id']}")


@pytest.fixture
def test_chapter(test_project):
    """Create a test chapter and clean up after."""
    response = client.post("/api/chapters", json={
        "projectId": test_project["id"],
        "title": "Contract Test Chapter",
        "orderIndex": 0,
        "defaultTtsEngine": "xtts",
        "defaultTtsModelName": "v2"
    })
    assert response.status_code == 200, f"Chapter creation failed: {response.json()}"
    chapter = response.json()

    yield chapter

    # Cleanup handled by project deletion (cascade)


@pytest.fixture
def test_segment(test_chapter):
    """Create a test segment."""
    response = client.post("/api/segments", json={
        "chapterId": test_chapter["id"],
        "text": "Dies ist ein Test-Segment für Contract Testing.",
        "orderIndex": 0,
        "ttsEngine": "xtts",
        "ttsModelName": "v2",
        "ttsSpeakerName": None,
        "language": "de"
    })
    assert response.status_code == 200
    segment = response.json()

    yield segment

    # Cleanup handled by project deletion (cascade)


# ============================================================================
# Contract Tests - GET /segments/{id}
# ============================================================================

class TestSegmentGetContract:
    """Contract tests for GET /segments/{segment_id}."""

    def test_get_segment_returns_200(self, test_segment):
        """GET existing segment returns 200."""
        response = client.get(f"/api/segments/{test_segment['id']}")
        assert response.status_code == 200

    def test_get_segment_validates_against_schema(self, test_segment):
        """Response validates against SegmentResponse Pydantic model."""
        response = client.get(f"/api/segments/{test_segment['id']}")
        data = response.json()

        # Pydantic validation - raises if schema doesn't match
        validated = SegmentResponse.model_validate(data)

        assert validated.id == test_segment["id"]
        assert validated.text == "Dies ist ein Test-Segment für Contract Testing."

    def test_get_segment_uses_camel_case(self, test_segment):
        """Response uses camelCase field names."""
        response = client.get(f"/api/segments/{test_segment['id']}")
        data = response.json()

        # Required camelCase fields
        expected_fields = [
            "id", "chapterId", "text", "ttsEngine", "ttsModelName",
            "language", "segmentType", "orderIndex", "status",
            "createdAt", "updatedAt"
        ]

        for field in expected_fields:
            assert field in data, f"Expected camelCase field '{field}' not found"

        # snake_case should NOT be present
        forbidden_fields = ["chapter_id", "tts_engine", "order_index", "created_at"]
        for field in forbidden_fields:
            assert field not in data, f"Unexpected snake_case field '{field}' found"

    def test_get_segment_returns_404_for_unknown(self):
        """GET unknown segment returns 404."""
        response = client.get("/api/segments/nonexistent-id-12345")
        assert response.status_code == 404

    def test_segment_has_correct_default_values(self, test_segment):
        """New segment has correct default values."""
        response = client.get(f"/api/segments/{test_segment['id']}")
        data = response.json()

        assert data["segmentType"] == "standard"
        assert data["status"] == "pending"
        assert not data["isFrozen"]
        assert data["pauseDuration"] == 0


# ============================================================================
# Contract Tests - POST /segments (Create)
# ============================================================================

class TestSegmentCreateContract:
    """Contract tests for POST /segments."""

    def test_create_segment_returns_segment_response(self, test_chapter):
        """Create returns a valid SegmentResponse."""
        response = client.post("/api/segments", json={
            "chapterId": test_chapter["id"],
            "text": "Neues Test-Segment",
            "orderIndex": 99,
            "ttsEngine": "xtts",
            "ttsModelName": "v2",
            "language": "de"
        })

        assert response.status_code == 200
        data = response.json()

        # Validate against schema
        validated = SegmentResponse.model_validate(data)
        assert validated.text == "Neues Test-Segment"
        assert validated.order_index == 99

        # Cleanup
        client.delete(f"/api/segments/{data['id']}")

    def test_create_divider_segment(self, test_chapter):
        """Create divider segment with pause duration."""
        response = client.post("/api/segments", json={
            "chapterId": test_chapter["id"],
            "text": "",
            "orderIndex": 1,
            "ttsEngine": "xtts",
            "ttsModelName": "v2",
            "language": "de",
            "segmentType": "divider",
            "pauseDuration": 2000
        })

        assert response.status_code == 200
        data = response.json()

        assert data["segmentType"] == "divider"
        assert data["pauseDuration"] == 2000

        # Cleanup
        client.delete(f"/api/segments/{data['id']}")


# ============================================================================
# Contract Tests - DELETE /segments/{id}
# ============================================================================

class TestSegmentDeleteContract:
    """Contract tests for DELETE /segments/{segment_id}."""

    def test_delete_segment_returns_delete_response(self, test_chapter):
        """Delete returns DeleteResponse schema."""
        # Create segment to delete
        create_response = client.post("/api/segments", json={
            "chapterId": test_chapter["id"],
            "text": "Zu löschendes Segment",
            "orderIndex": 0,
            "ttsEngine": "xtts",
            "ttsModelName": "v2",
            "language": "de"
        })
        segment_id = create_response.json()["id"]

        # Delete it
        response = client.delete(f"/api/segments/{segment_id}")

        assert response.status_code == 200
        data = response.json()

        # Validate against schema
        validated = DeleteResponse.model_validate(data)
        assert validated.success

    def test_delete_unknown_segment_returns_404(self):
        """Delete unknown segment returns 404."""
        response = client.delete("/api/segments/nonexistent-id-12345")
        assert response.status_code == 404
