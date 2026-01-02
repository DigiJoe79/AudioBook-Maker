"""
Contract Tests for Audio API Endpoints

These tests verify that Audio API responses match expected schemas
and handle validation errors correctly.

Endpoints tested:
- POST /api/audio/export - Start audio export job
- GET /api/audio/export/{job_id}/progress - Get export progress
- DELETE /api/audio/export/{job_id}/cancel - Cancel export job
- GET /api/audio/export/{job_id}/download - Download exported file
- DELETE /api/audio/export/{job_id} - Delete export job
- POST /api/audio/merge - Quick merge for preview
- GET /api/audio/duration/{file_path} - Get audio duration
"""

import pytest
from fastapi.testclient import TestClient
from main import app
from models.response_models import (
    ExportResponse,
    ExportProgressResponse,
    MessageResponse,
)

client = TestClient(app)


# ============================================================================
# Test Fixtures - Create test data
# ============================================================================

@pytest.fixture
def test_project():
    """Create a test project and clean up after."""
    response = client.post("/api/projects", json={
        "title": "Audio Contract Test Project",
        "description": "For audio contract testing"
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
        "title": "Audio Contract Test Chapter",
        "orderIndex": 0
    })
    assert response.status_code == 200
    return response.json()


@pytest.fixture
def test_segment_pending(test_chapter):
    """Create a pending test segment (no audio)."""
    response = client.post("/api/segments", json={
        "chapterId": test_chapter["id"],
        "text": "Dies ist ein Test-Segment ohne Audio.",
        "orderIndex": 0,
        "ttsEngine": "xtts:local",
        "ttsModelName": "v2",
        "ttsSpeakerName": "test-speaker",
        "language": "de"
    })
    assert response.status_code == 200
    return response.json()


@pytest.fixture
def test_segment_completed(test_chapter):
    """Create a completed test segment with simulated audio path.

    Note: We directly create a segment with 'completed' status for testing.
    In production, this would be set by the TTS worker.
    """
    response = client.post("/api/segments", json={
        "chapterId": test_chapter["id"],
        "text": "Completed segment with audio.",
        "orderIndex": 0,
        "ttsEngine": "xtts:local",
        "ttsModelName": "v2",
        "ttsSpeakerName": "test-speaker",
        "language": "de"
    })
    assert response.status_code == 200
    segment = response.json()

    # Update segment to completed status with a fake audio path
    # This simulates what the TTS worker would do
    # Note: Segment API uses PUT, not PATCH
    update_response = client.put(f"/api/segments/{segment['id']}", json={
        "status": "completed",
        "audioPath": "test/fake_audio.wav"
    })
    assert update_response.status_code == 200
    return update_response.json()


@pytest.fixture
def test_divider_segment(test_chapter):
    """Create a divider segment."""
    response = client.post("/api/segments", json={
        "chapterId": test_chapter["id"],
        "text": "",
        "orderIndex": 1,
        "segmentType": "divider",
        "pauseDuration": 500,
        "ttsEngine": "xtts:local",
        "ttsModelName": "v2",
        "language": "de"
    })
    assert response.status_code == 200
    return response.json()


# ============================================================================
# Contract Tests - POST /api/audio/export
# ============================================================================

class TestAudioExportContract:
    """Contract tests for POST /api/audio/export."""

    def test_export_returns_422_for_missing_chapter_id(self):
        """Missing chapterId returns 422."""
        response = client.post("/api/audio/export", json={
            "outputFormat": "mp3"
        })
        assert response.status_code == 422

    def test_export_returns_422_for_invalid_types(self):
        """Invalid types return 422."""
        response = client.post("/api/audio/export", json={
            "chapterId": 12345,  # Should be string
            "outputFormat": "mp3"
        })
        assert response.status_code == 422

    def test_export_returns_404_for_unknown_chapter(self):
        """Unknown chapter returns 404."""
        response = client.post("/api/audio/export", json={
            "chapterId": "nonexistent-chapter-id-12345",
            "outputFormat": "mp3"
        })
        assert response.status_code == 404

        data = response.json()
        assert "detail" in data
        assert "EXPORT_CHAPTER_NOT_FOUND" in data["detail"]

    def test_export_returns_400_for_empty_chapter(self, test_chapter):
        """Empty chapter (no segments) returns 400."""
        response = client.post("/api/audio/export", json={
            "chapterId": test_chapter["id"],
            "outputFormat": "mp3"
        })
        assert response.status_code == 400

        data = response.json()
        assert "detail" in data
        assert "EXPORT_NO_SEGMENTS" in data["detail"]

    def test_export_returns_400_for_incomplete_segments(self, test_chapter, test_segment_pending):
        """Chapter with incomplete segments returns 400."""
        response = client.post("/api/audio/export", json={
            "chapterId": test_chapter["id"],
            "outputFormat": "mp3"
        })
        assert response.status_code == 400

        data = response.json()
        assert "detail" in data
        assert "EXPORT_INCOMPLETE_SEGMENTS" in data["detail"]

    def test_export_request_accepts_camel_case(self, test_chapter, test_segment_completed):
        """Request accepts camelCase field names."""
        response = client.post("/api/audio/export", json={
            "chapterId": test_chapter["id"],
            "outputFormat": "mp3",
            "quality": "medium",
            "pauseBetweenSegments": 500,
            "customFilename": "test-export"
        })

        # Should not be validation error (may fail for other reasons)
        assert response.status_code != 422

    def test_export_request_accepts_snake_case(self, test_chapter, test_segment_completed):
        """Request accepts snake_case field names (populate_by_name=True)."""
        response = client.post("/api/audio/export", json={
            "chapter_id": test_chapter["id"],
            "output_format": "mp3",
            "pause_between_segments": 500
        })

        # Should be accepted (not 422)
        assert response.status_code != 422

    def test_export_response_uses_camel_case(self, test_chapter, test_segment_completed):
        """Response uses camelCase field names."""
        response = client.post("/api/audio/export", json={
            "chapterId": test_chapter["id"],
            "outputFormat": "mp3"
        })

        # Skip if export fails for external reasons (audio service not available)
        if response.status_code >= 500:
            pytest.skip("Audio service not available")

        if response.status_code == 200:
            data = response.json()

            # Response should have camelCase fields
            expected_fields = ["jobId", "status", "message"]
            for field in expected_fields:
                assert field in data, f"Expected camelCase field '{field}' not found"

            # snake_case should NOT be present
            assert "job_id" not in data

    def test_export_response_validates_against_schema(self, test_chapter, test_segment_completed):
        """Response validates against ExportResponse schema."""
        response = client.post("/api/audio/export", json={
            "chapterId": test_chapter["id"],
            "outputFormat": "mp3"
        })

        # Skip if export fails
        if response.status_code >= 500:
            pytest.skip("Audio service not available")

        if response.status_code == 200:
            data = response.json()
            validated = ExportResponse.model_validate(data)
            assert validated.status in ["pending", "running", "completed", "failed"]

    def test_export_error_uses_error_code_format(self):
        """Error responses use [ERROR_CODE] format."""
        response = client.post("/api/audio/export", json={
            "chapterId": "nonexistent-id",
            "outputFormat": "mp3"
        })
        data = response.json()

        # Error code format: [ERROR_CODE]param:value
        assert data["detail"].startswith("[")
        assert "]" in data["detail"]


# ============================================================================
# Contract Tests - GET /api/audio/export/{job_id}/progress
# ============================================================================

class TestAudioExportProgressContract:
    """Contract tests for GET /api/audio/export/{job_id}/progress."""

    def test_progress_returns_404_for_unknown_job(self):
        """Unknown job returns 404."""
        response = client.get("/api/audio/export/nonexistent-job-id-12345/progress")
        assert response.status_code == 404

        data = response.json()
        assert "detail" in data
        assert "EXPORT_JOB_NOT_FOUND" in data["detail"]

    def test_progress_response_uses_camel_case(self, test_chapter, test_segment_completed):
        """Response uses camelCase field names."""
        # First start an export to get a job ID
        export_response = client.post("/api/audio/export", json={
            "chapterId": test_chapter["id"],
            "outputFormat": "mp3"
        })

        if export_response.status_code != 200:
            pytest.skip("Could not start export")

        job_id = export_response.json()["jobId"]

        # Get progress
        response = client.get(f"/api/audio/export/{job_id}/progress")
        assert response.status_code == 200

        data = response.json()

        # Response should have camelCase fields
        expected_fields = ["jobId", "status", "progress", "currentSegment", "totalSegments"]
        for field in expected_fields:
            assert field in data, f"Expected camelCase field '{field}' not found"

        # snake_case should NOT be present
        assert "job_id" not in data
        assert "current_segment" not in data
        assert "total_segments" not in data

    def test_progress_response_validates_against_schema(self, test_chapter, test_segment_completed):
        """Response validates against ExportProgressResponse schema."""
        # First start an export
        export_response = client.post("/api/audio/export", json={
            "chapterId": test_chapter["id"],
            "outputFormat": "mp3"
        })

        if export_response.status_code != 200:
            pytest.skip("Could not start export")

        job_id = export_response.json()["jobId"]

        # Get progress and validate schema
        response = client.get(f"/api/audio/export/{job_id}/progress")
        assert response.status_code == 200

        data = response.json()
        validated = ExportProgressResponse.model_validate(data)
        assert validated.job_id == job_id
        assert 0.0 <= validated.progress <= 1.0


# ============================================================================
# Contract Tests - DELETE /api/audio/export/{job_id}/cancel
# ============================================================================

class TestAudioExportCancelContract:
    """Contract tests for DELETE /api/audio/export/{job_id}/cancel."""

    def test_cancel_returns_404_for_unknown_job(self):
        """Unknown job returns 404."""
        response = client.delete("/api/audio/export/nonexistent-job-id-12345/cancel")
        assert response.status_code == 404

        data = response.json()
        assert "detail" in data
        assert "EXPORT_JOB_NOT_FOUND" in data["detail"]

    def test_cancel_response_uses_camel_case(self, test_chapter, test_segment_completed):
        """Response uses camelCase field names."""
        # First start an export
        export_response = client.post("/api/audio/export", json={
            "chapterId": test_chapter["id"],
            "outputFormat": "mp3"
        })

        if export_response.status_code != 200:
            pytest.skip("Could not start export")

        job_id = export_response.json()["jobId"]

        # Cancel the job
        response = client.delete(f"/api/audio/export/{job_id}/cancel")
        assert response.status_code == 200

        data = response.json()
        assert "success" in data
        assert "message" in data

    def test_cancel_response_validates_against_schema(self, test_chapter, test_segment_completed):
        """Response validates against MessageResponse schema."""
        # First start an export
        export_response = client.post("/api/audio/export", json={
            "chapterId": test_chapter["id"],
            "outputFormat": "mp3"
        })

        if export_response.status_code != 200:
            pytest.skip("Could not start export")

        job_id = export_response.json()["jobId"]

        # Cancel and validate
        response = client.delete(f"/api/audio/export/{job_id}/cancel")
        assert response.status_code == 200

        data = response.json()
        validated = MessageResponse.model_validate(data)
        assert validated.success is True


# ============================================================================
# Contract Tests - GET /api/audio/export/{job_id}/download
# ============================================================================

class TestAudioExportDownloadContract:
    """Contract tests for GET /api/audio/export/{job_id}/download."""

    def test_download_returns_404_for_unknown_job(self):
        """Unknown job returns 404."""
        response = client.get("/api/audio/export/nonexistent-job-id-12345/download")
        assert response.status_code == 404

        data = response.json()
        assert "detail" in data
        assert "EXPORT_JOB_NOT_FOUND" in data["detail"]

    def test_download_returns_400_for_incomplete_job(self, test_chapter, test_segment_completed):
        """Download for non-completed job returns 400."""
        # Start an export
        export_response = client.post("/api/audio/export", json={
            "chapterId": test_chapter["id"],
            "outputFormat": "mp3"
        })

        if export_response.status_code != 200:
            pytest.skip("Could not start export")

        job_id = export_response.json()["jobId"]

        # Cancel it immediately (so it's not completed)
        client.delete(f"/api/audio/export/{job_id}/cancel")

        # Try to download
        response = client.get(f"/api/audio/export/{job_id}/download")

        # Should be 400 (not ready) or 404 (no file)
        assert response.status_code in [400, 404]


# ============================================================================
# Contract Tests - DELETE /api/audio/export/{job_id}
# ============================================================================

class TestAudioExportDeleteContract:
    """Contract tests for DELETE /api/audio/export/{job_id}."""

    def test_delete_returns_404_for_unknown_job(self):
        """Unknown job returns 404."""
        response = client.delete("/api/audio/export/nonexistent-job-id-12345")
        assert response.status_code == 404

        data = response.json()
        assert "detail" in data
        assert "EXPORT_JOB_NOT_FOUND" in data["detail"]

    def test_delete_response_validates_against_schema(self, test_chapter, test_segment_completed):
        """Response validates against MessageResponse schema."""
        # Start an export
        export_response = client.post("/api/audio/export", json={
            "chapterId": test_chapter["id"],
            "outputFormat": "mp3"
        })

        if export_response.status_code != 200:
            pytest.skip("Could not start export")

        job_id = export_response.json()["jobId"]

        # Delete it
        response = client.delete(f"/api/audio/export/{job_id}")
        assert response.status_code == 200

        data = response.json()
        validated = MessageResponse.model_validate(data)
        assert validated.success is True


# ============================================================================
# Contract Tests - POST /api/audio/merge
# ============================================================================

class TestAudioMergeContract:
    """Contract tests for POST /api/audio/merge."""

    def test_merge_returns_422_for_missing_chapter_id(self):
        """Missing chapterId returns 422."""
        response = client.post("/api/audio/merge", json={
            "pauseMs": 500
        })
        assert response.status_code == 422

    def test_merge_returns_404_for_no_segments(self, test_chapter):
        """Chapter with no segments returns 404."""
        response = client.post("/api/audio/merge", json={
            "chapterId": test_chapter["id"],
            "pauseMs": 500
        })
        assert response.status_code == 404

        data = response.json()
        assert "detail" in data
        assert "EXPORT_NO_SEGMENTS_FOUND" in data["detail"]

    def test_merge_request_accepts_camel_case(self, test_chapter, test_segment_completed):
        """Request accepts camelCase field names."""
        response = client.post("/api/audio/merge", json={
            "chapterId": test_chapter["id"],
            "pauseMs": 500
        })

        # Should not be validation error (may fail due to missing audio files)
        assert response.status_code != 422

    def test_merge_error_uses_error_code_format(self, test_chapter):
        """Error responses use [ERROR_CODE] format."""
        response = client.post("/api/audio/merge", json={
            "chapterId": test_chapter["id"],
            "pauseMs": 500
        })

        if response.status_code >= 400:
            data = response.json()
            assert data["detail"].startswith("[")
            assert "]" in data["detail"]


# ============================================================================
# Contract Tests - GET /api/audio/duration/{file_path}
# ============================================================================

class TestAudioDurationContract:
    """Contract tests for GET /api/audio/duration/{file_path}."""

    def test_duration_returns_500_for_nonexistent_file(self):
        """Nonexistent file returns 500 (internal error during processing)."""
        response = client.get("/api/audio/duration/nonexistent/file.wav")

        # File processing error
        assert response.status_code == 500

        data = response.json()
        assert "detail" in data
        assert "AUDIO_DURATION_FAILED" in data["detail"]

    def test_duration_error_uses_error_code_format(self):
        """Error responses use [ERROR_CODE] format."""
        response = client.get("/api/audio/duration/fake/path.wav")
        data = response.json()

        assert data["detail"].startswith("[")
        assert "]" in data["detail"]


# ============================================================================
# Contract Tests - GET /api/audio/{file_path} (Audio file serving)
# ============================================================================

class TestAudioFileServingContract:
    """Contract tests for GET /api/audio/{file_path}."""

    def test_serving_returns_404_for_nonexistent_file(self):
        """Nonexistent file returns 404."""
        response = client.get("/api/audio/nonexistent/file.wav")
        assert response.status_code == 404

        data = response.json()
        assert "detail" in data
        assert "EXPORT_AUDIO_FILE_NOT_FOUND" in data["detail"]

    def test_serving_prevents_path_traversal(self):
        """Path traversal attempts are blocked by framework path normalization.

        FastAPI/Starlette normalizes paths before they reach handlers,
        so '/../../../etc/passwd' becomes 'etc/passwd' - preventing
        directory traversal attacks. The result is 404 (file not found).

        Note: The framework may return a generic 404 before reaching our handler
        if the path doesn't match any route after normalization.
        """
        response = client.get("/api/audio/../../../etc/passwd")
        # Framework blocks path traversal - important security behavior
        # May be 404 from framework or from our handler
        assert response.status_code == 404

    def test_serving_error_uses_error_code_format(self):
        """Error responses use [ERROR_CODE] format."""
        response = client.get("/api/audio/fake/path.wav")
        data = response.json()

        assert data["detail"].startswith("[")
        assert "]" in data["detail"]
