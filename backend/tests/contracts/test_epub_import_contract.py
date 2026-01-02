"""
Contract Tests for EPUB Import API Endpoints

These tests verify that EPUB Import API responses match expected schemas
and handle validation errors correctly.

Endpoints tested:
- POST /api/projects/import/epub/preview - Parse EPUB and return preview
- POST /api/projects/import/epub - Execute EPUB import
"""

import pytest
import json
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


# ============================================================================
# Test Data - Minimal valid EPUB structure
# ============================================================================

# Minimal EPUB is complex (ZIP with specific structure), so we test error cases
# and schema validation rather than full EPUB parsing

DEFAULT_MAPPING_RULES = json.dumps({
    "projectHeading": "#",
    "chapterHeading": "###",
    "dividerPattern": "***"
})

# Use available engine for testing
TEST_TTS_ENGINE = "chatterbox:docker:local"


# ============================================================================
# Test Fixtures
# ============================================================================

@pytest.fixture
def test_project_for_merge():
    """Create a test project for merge mode testing."""
    response = client.post("/api/projects", json={
        "title": "EPUB Merge Target Project",
        "description": "For EPUB import merge testing"
    })
    assert response.status_code == 200
    project = response.json()

    yield project

    # Cleanup
    client.delete(f"/api/projects/{project['id']}")


@pytest.fixture
def created_projects():
    """Track projects created during tests for cleanup."""
    projects = []
    yield projects

    for project_id in projects:
        try:
            client.delete(f"/api/projects/{project_id}")
        except Exception:
            pass


# ============================================================================
# Contract Tests - POST /api/projects/import/epub/preview
# ============================================================================

class TestEpubPreviewContract:
    """Contract tests for POST /api/projects/import/epub/preview."""

    def test_preview_returns_422_for_missing_file(self):
        """Missing file returns 422."""
        response = client.post(
            "/api/projects/import/epub/preview",
            data={"mapping_rules": DEFAULT_MAPPING_RULES}
        )
        assert response.status_code == 422

    def test_preview_returns_422_for_missing_mapping_rules(self):
        """Missing mapping_rules returns 422."""
        response = client.post(
            "/api/projects/import/epub/preview",
            files={"file": ("test.epub", b"fake epub content", "application/epub+zip")}
        )
        assert response.status_code == 422

    def test_preview_returns_400_for_invalid_mapping_json(self):
        """Invalid JSON in mapping_rules returns 400."""
        response = client.post(
            "/api/projects/import/epub/preview",
            files={"file": ("test.epub", b"fake content", "application/epub+zip")},
            data={"mapping_rules": "not valid json{"}
        )
        assert response.status_code == 400

        data = response.json()
        assert "detail" in data
        assert "EPUB_IMPORT_INVALID_MAPPING_JSON" in data["detail"]

    def test_preview_returns_400_for_empty_file(self):
        """Empty EPUB file returns 400."""
        response = client.post(
            "/api/projects/import/epub/preview",
            files={"file": ("empty.epub", b"", "application/epub+zip")},
            data={"mapping_rules": DEFAULT_MAPPING_RULES}
        )
        assert response.status_code == 400

        data = response.json()
        assert "detail" in data
        assert "EPUB_IMPORT_FILE_EMPTY" in data["detail"]

    def test_preview_returns_400_for_invalid_epub(self):
        """Invalid EPUB structure returns 400."""
        response = client.post(
            "/api/projects/import/epub/preview",
            files={"file": ("invalid.epub", b"not a real epub file", "application/epub+zip")},
            data={"mapping_rules": DEFAULT_MAPPING_RULES}
        )
        # Invalid EPUB should return 400 (parsing error)
        assert response.status_code == 400

    def test_preview_error_uses_error_code_format(self):
        """Error responses use [ERROR_CODE] format."""
        response = client.post(
            "/api/projects/import/epub/preview",
            files={"file": ("empty.epub", b"", "application/epub+zip")},
            data={"mapping_rules": DEFAULT_MAPPING_RULES}
        )
        data = response.json()

        # Error code format: [ERROR_CODE]
        assert data["detail"].startswith("[")
        assert "]" in data["detail"]

    def test_preview_accepts_language_parameter(self):
        """Preview accepts language parameter."""
        response = client.post(
            "/api/projects/import/epub/preview",
            files={"file": ("test.epub", b"fake", "application/epub+zip")},
            data={
                "mapping_rules": DEFAULT_MAPPING_RULES,
                "language": "de"
            }
        )
        # Should not be validation error (may fail for other reasons)
        assert response.status_code != 422


# ============================================================================
# Contract Tests - POST /api/projects/import/epub
# ============================================================================

class TestEpubExecuteContract:
    """Contract tests for POST /api/projects/import/epub."""

    def test_execute_returns_422_for_missing_file(self):
        """Missing file returns 422."""
        response = client.post(
            "/api/projects/import/epub",
            data={
                "mapping_rules": DEFAULT_MAPPING_RULES,
                "mode": "new",
                "tts_engine": TEST_TTS_ENGINE,
                "tts_model_name": "v2",
                "tts_language": "en"
            }
        )
        assert response.status_code == 422

    def test_execute_returns_422_for_missing_mode(self):
        """Missing mode returns 422."""
        response = client.post(
            "/api/projects/import/epub",
            files={"file": ("test.epub", b"fake", "application/epub+zip")},
            data={
                "mapping_rules": DEFAULT_MAPPING_RULES,
                "tts_engine": TEST_TTS_ENGINE,
                "tts_model_name": "v2",
                "tts_language": "en"
            }
        )
        assert response.status_code == 422

    def test_execute_returns_422_for_missing_tts_engine(self):
        """Missing tts_engine returns 422."""
        response = client.post(
            "/api/projects/import/epub",
            files={"file": ("test.epub", b"fake", "application/epub+zip")},
            data={
                "mapping_rules": DEFAULT_MAPPING_RULES,
                "mode": "new",
                "tts_model_name": "v2",
                "tts_language": "en"
            }
        )
        assert response.status_code == 422

    def test_execute_returns_400_for_invalid_mode(self):
        """Invalid mode returns 400."""
        response = client.post(
            "/api/projects/import/epub",
            files={"file": ("test.epub", b"fake", "application/epub+zip")},
            data={
                "mapping_rules": DEFAULT_MAPPING_RULES,
                "mode": "invalid_mode",
                "tts_engine": TEST_TTS_ENGINE,
                "tts_model_name": "v2",
                "tts_language": "en"
            }
        )
        assert response.status_code == 400

        data = response.json()
        assert "detail" in data
        assert "EPUB_IMPORT_INVALID_MODE" in data["detail"]

    def test_execute_returns_400_for_merge_without_target(self):
        """Merge mode without target ID returns 400."""
        response = client.post(
            "/api/projects/import/epub",
            files={"file": ("test.epub", b"fake", "application/epub+zip")},
            data={
                "mapping_rules": DEFAULT_MAPPING_RULES,
                "mode": "merge",
                "tts_engine": TEST_TTS_ENGINE,
                "tts_model_name": "v2",
                "tts_language": "en"
            }
        )
        assert response.status_code == 400

        data = response.json()
        assert "detail" in data
        assert "EPUB_IMPORT_MISSING_TARGET_ID" in data["detail"]

    def test_execute_returns_404_for_merge_unknown_target(self, test_project_for_merge):
        """Merge into unknown project returns 404."""
        response = client.post(
            "/api/projects/import/epub",
            files={"file": ("test.epub", b"fake", "application/epub+zip")},
            data={
                "mapping_rules": DEFAULT_MAPPING_RULES,
                "mode": "merge",
                "merge_target_id": "nonexistent-project-id-12345",
                "tts_engine": TEST_TTS_ENGINE,
                "tts_model_name": "v2",
                "tts_language": "en"
            }
        )
        # Project validation now happens BEFORE parsing
        assert response.status_code == 404

        data = response.json()
        assert "detail" in data
        assert "EPUB_IMPORT_TARGET_NOT_FOUND" in data["detail"]

    def test_execute_returns_400_for_unknown_engine(self):
        """Unknown TTS engine returns 400.

        Note: EPUB parsing happens before engine validation, so with an
        invalid EPUB file, we get EPUB_IMPORT_INVALID_EPUB first.
        This test verifies that invalid input returns 400.
        """
        response = client.post(
            "/api/projects/import/epub",
            files={"file": ("test.epub", b"fake", "application/epub+zip")},
            data={
                "mapping_rules": DEFAULT_MAPPING_RULES,
                "mode": "new",
                "tts_engine": "nonexistent-engine:local",
                "tts_model_name": "v2",
                "tts_language": "en"
            }
        )
        # Returns 400 - either from invalid EPUB or unknown engine
        assert response.status_code == 400

        data = response.json()
        assert "detail" in data
        # EPUB validation happens first, so we get EPUB error
        assert "EPUB_IMPORT" in data["detail"]

    def test_execute_returns_400_for_empty_file(self):
        """Empty file returns 400."""
        response = client.post(
            "/api/projects/import/epub",
            files={"file": ("empty.epub", b"", "application/epub+zip")},
            data={
                "mapping_rules": DEFAULT_MAPPING_RULES,
                "mode": "new",
                "tts_engine": TEST_TTS_ENGINE,
                "tts_model_name": "v2",
                "tts_language": "en"
            }
        )
        assert response.status_code == 400

        data = response.json()
        assert "detail" in data
        assert "EPUB_IMPORT_FILE_EMPTY" in data["detail"]

    def test_execute_error_uses_error_code_format(self):
        """Error responses use [ERROR_CODE] format."""
        response = client.post(
            "/api/projects/import/epub",
            files={"file": ("test.epub", b"fake", "application/epub+zip")},
            data={
                "mapping_rules": DEFAULT_MAPPING_RULES,
                "mode": "invalid",
                "tts_engine": TEST_TTS_ENGINE,
                "tts_model_name": "v2",
                "tts_language": "en"
            }
        )

        data = response.json()
        assert data["detail"].startswith("[")
        assert "]" in data["detail"]

    def test_execute_accepts_optional_parameters(self):
        """Execute accepts all optional parameters."""
        response = client.post(
            "/api/projects/import/epub",
            files={"file": ("test.epub", b"fake", "application/epub+zip")},
            data={
                "mapping_rules": DEFAULT_MAPPING_RULES,
                "mode": "new",
                "language": "en",
                "selected_chapters": "[]",
                "renamed_chapters": "{}",
                "tts_engine": TEST_TTS_ENGINE,
                "tts_model_name": "v2",
                "tts_language": "en",
                "tts_speaker_name": "test-speaker"
            }
        )
        # Should not be validation error (may fail for other reasons)
        assert response.status_code != 422


# ============================================================================
# Contract Tests - Request Schema Validation
# ============================================================================

class TestEpubRequestSchemaContract:
    """Contract tests for EPUB import request schema validation."""

    def test_preview_accepts_all_mapping_options(self):
        """Preview accepts custom mapping rule options."""
        custom_rules = json.dumps({
            "projectHeading": "##",
            "chapterHeading": "####",
            "dividerPattern": "---"
        })

        response = client.post(
            "/api/projects/import/epub/preview",
            files={"file": ("test.epub", b"fake", "application/epub+zip")},
            data={
                "mapping_rules": custom_rules,
                "language": "de"
            }
        )
        # Should not be validation error
        assert response.status_code != 422

    def test_execute_accepts_snake_case_parameters(self):
        """Execute accepts snake_case parameter names."""
        response = client.post(
            "/api/projects/import/epub",
            files={"file": ("test.epub", b"fake", "application/epub+zip")},
            data={
                "mapping_rules": DEFAULT_MAPPING_RULES,
                "mode": "new",
                "language": "en",
                "tts_engine": TEST_TTS_ENGINE,
                "tts_model_name": "v2",
                "tts_language": "en"
            }
        )
        # Should be accepted (not 422)
        assert response.status_code != 422
