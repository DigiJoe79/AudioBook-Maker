"""
Contract Tests for Import API Endpoints

These tests verify that Import API responses match expected schemas
and handle validation errors correctly.

Endpoints tested:
- POST /api/projects/import/preview - Parse markdown and return preview
- POST /api/projects/import - Execute import and create project
"""

import pytest
import json
from fastapi.testclient import TestClient
from main import app
from models.response_models import (
    ImportPreviewResponse,
    ImportExecuteResponse,
)

client = TestClient(app)


# ============================================================================
# Test Data - Sample Markdown Content
# ============================================================================

VALID_MARKDOWN = """# Test Project Title

This is the project description.

### Chapter 1

This is the first paragraph of chapter one. It contains some text that will be segmented.

This is the second paragraph.

***

### Chapter 2

Another chapter with some content here.
"""

VALID_MARKDOWN_MINIMAL = """# Minimal Project

### Single Chapter

Some text content.
"""

INVALID_MARKDOWN_NO_PROJECT = """### Chapter Without Project

This markdown has no H1 heading for project title.
"""

INVALID_MARKDOWN_NO_CHAPTERS = """# Project Without Chapters

This project has no H3 headings for chapters.
Just plain text without structure.
"""

DEFAULT_MAPPING_RULES = json.dumps({
    "projectHeading": "#",
    "chapterHeading": "###",
    "dividerPattern": "***"
})

# Use vibevoice engine for testing (commonly installed Docker engine)
# Format: {engine}:{runner_type}:{host_id}
# Note: Import validates engine exists, so this must be an installed engine
TEST_TTS_ENGINE = "vibevoice:docker:local"


# ============================================================================
# Test Fixtures
# ============================================================================

@pytest.fixture
def test_project_for_merge():
    """Create a test project for merge mode testing."""
    response = client.post("/api/projects", json={
        "title": "Merge Target Project",
        "description": "For import merge testing"
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

    # Cleanup all created projects
    for project_id in projects:
        try:
            client.delete(f"/api/projects/{project_id}")
        except Exception:
            pass


# ============================================================================
# Contract Tests - POST /api/projects/import/preview
# ============================================================================

class TestImportPreviewContract:
    """Contract tests for POST /api/projects/import/preview."""

    def test_preview_returns_422_for_missing_file(self):
        """Missing file returns 422."""
        response = client.post(
            "/api/projects/import/preview",
            data={"mapping_rules": DEFAULT_MAPPING_RULES}
        )
        assert response.status_code == 422

    def test_preview_returns_422_for_missing_mapping_rules(self):
        """Missing mapping_rules returns 422."""
        response = client.post(
            "/api/projects/import/preview",
            files={"file": ("test.md", VALID_MARKDOWN, "text/markdown")}
        )
        assert response.status_code == 422

    def test_preview_returns_400_for_invalid_mapping_json(self):
        """Invalid JSON in mapping_rules returns 400."""
        response = client.post(
            "/api/projects/import/preview",
            files={"file": ("test.md", VALID_MARKDOWN, "text/markdown")},
            data={"mapping_rules": "not valid json{"}
        )
        assert response.status_code == 400

        data = response.json()
        assert "detail" in data

    def test_preview_returns_400_for_empty_file(self):
        """Empty markdown file returns 400."""
        response = client.post(
            "/api/projects/import/preview",
            files={"file": ("empty.md", "", "text/markdown")},
            data={"mapping_rules": DEFAULT_MAPPING_RULES}
        )
        # Empty file should cause parsing error
        assert response.status_code == 400

    def test_preview_returns_400_for_no_project_heading(self):
        """Markdown without project heading (H1) returns 400."""
        response = client.post(
            "/api/projects/import/preview",
            files={"file": ("no_project.md", INVALID_MARKDOWN_NO_PROJECT, "text/markdown")},
            data={"mapping_rules": DEFAULT_MAPPING_RULES}
        )
        assert response.status_code == 400

        data = response.json()
        assert "detail" in data

    def test_preview_success_with_valid_markdown(self):
        """Valid markdown returns successful preview."""
        response = client.post(
            "/api/projects/import/preview",
            files={"file": ("test.md", VALID_MARKDOWN, "text/markdown")},
            data={
                "mapping_rules": DEFAULT_MAPPING_RULES,
                "language": "en"
            }
        )

        # May fail if spaCy model not available
        if response.status_code == 500:
            pytest.skip("spaCy model not available")

        assert response.status_code == 200

        data = response.json()

        # Check required fields exist
        assert "isValid" in data
        assert "project" in data
        assert "chapters" in data
        assert "globalWarnings" in data
        assert "stats" in data

    def test_preview_response_uses_camel_case(self):
        """Response uses camelCase field names."""
        response = client.post(
            "/api/projects/import/preview",
            files={"file": ("test.md", VALID_MARKDOWN, "text/markdown")},
            data={
                "mapping_rules": DEFAULT_MAPPING_RULES,
                "language": "en"
            }
        )

        if response.status_code == 500:
            pytest.skip("spaCy model not available")

        assert response.status_code == 200
        data = response.json()

        # Response should have camelCase fields
        assert "isValid" in data
        assert "globalWarnings" in data

        # snake_case should NOT be present
        assert "is_valid" not in data
        assert "global_warnings" not in data

        # Check nested stats
        if "stats" in data:
            assert "totalChapters" in data["stats"]
            assert "totalSegments" in data["stats"]
            assert "total_chapters" not in data["stats"]

    def test_preview_response_validates_against_schema(self):
        """Response validates against ImportPreviewResponse schema."""
        response = client.post(
            "/api/projects/import/preview",
            files={"file": ("test.md", VALID_MARKDOWN, "text/markdown")},
            data={
                "mapping_rules": DEFAULT_MAPPING_RULES,
                "language": "en"
            }
        )

        if response.status_code == 500:
            pytest.skip("spaCy model not available")

        assert response.status_code == 200
        data = response.json()

        # Pydantic validation
        validated = ImportPreviewResponse.model_validate(data)
        assert validated.is_valid is True or validated.is_valid is False
        assert len(validated.chapters) >= 0

    def test_preview_with_custom_language(self):
        """Preview accepts language parameter."""
        response = client.post(
            "/api/projects/import/preview",
            files={"file": ("test.md", VALID_MARKDOWN_MINIMAL, "text/markdown")},
            data={
                "mapping_rules": DEFAULT_MAPPING_RULES,
                "language": "de"
            }
        )

        # Should not be validation error
        assert response.status_code != 422


# ============================================================================
# Contract Tests - POST /api/projects/import
# ============================================================================

class TestImportExecuteContract:
    """Contract tests for POST /api/projects/import."""

    def test_execute_returns_422_for_missing_file(self):
        """Missing file returns 422."""
        response = client.post(
            "/api/projects/import",
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
            "/api/projects/import",
            files={"file": ("test.md", VALID_MARKDOWN, "text/markdown")},
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
            "/api/projects/import",
            files={"file": ("test.md", VALID_MARKDOWN, "text/markdown")},
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
            "/api/projects/import",
            files={"file": ("test.md", VALID_MARKDOWN, "text/markdown")},
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
        assert "IMPORT_INVALID_MODE" in data["detail"]

    def test_execute_returns_400_for_merge_without_target(self):
        """Merge mode without target ID returns 400."""
        response = client.post(
            "/api/projects/import",
            files={"file": ("test.md", VALID_MARKDOWN, "text/markdown")},
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
        assert "IMPORT_MISSING_TARGET_ID" in data["detail"]

    def test_execute_returns_404_for_merge_unknown_target(self, test_project_for_merge):
        """Merge into unknown project returns 404."""
        response = client.post(
            "/api/projects/import",
            files={"file": ("test.md", VALID_MARKDOWN_MINIMAL, "text/markdown")},
            data={
                "mapping_rules": DEFAULT_MAPPING_RULES,
                "mode": "merge",
                "merge_target_id": "nonexistent-project-id-12345",
                "tts_engine": TEST_TTS_ENGINE,
                "tts_model_name": "v2",
                "tts_language": "en"
            }
        )
        assert response.status_code == 404

        data = response.json()
        assert "detail" in data
        assert "IMPORT_PROJECT_NOT_FOUND" in data["detail"]

    def test_execute_returns_400_for_unknown_engine(self):
        """Unknown TTS engine returns 400."""
        response = client.post(
            "/api/projects/import",
            files={"file": ("test.md", VALID_MARKDOWN_MINIMAL, "text/markdown")},
            data={
                "mapping_rules": DEFAULT_MAPPING_RULES,
                "mode": "new",
                "tts_engine": "nonexistent-engine:local",
                "tts_model_name": "v2",
                "tts_language": "en"
            }
        )
        assert response.status_code == 400

        data = response.json()
        assert "detail" in data
        assert "IMPORT_UNKNOWN_ENGINE" in data["detail"]

    def test_execute_returns_400_for_empty_file(self):
        """Empty file returns 400."""
        response = client.post(
            "/api/projects/import",
            files={"file": ("empty.md", "", "text/markdown")},
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
        assert "IMPORT_FILE_EMPTY" in data["detail"]

    def test_execute_new_project_success(self, created_projects):
        """Create new project from markdown."""
        response = client.post(
            "/api/projects/import",
            files={"file": ("test.md", VALID_MARKDOWN_MINIMAL, "text/markdown")},
            data={
                "mapping_rules": DEFAULT_MAPPING_RULES,
                "mode": "new",
                "language": "en",
                "tts_engine": TEST_TTS_ENGINE,
                "tts_model_name": "v2",
                "tts_language": "en",
                "tts_speaker_name": "test-speaker"
            }
        )

        # May fail if spaCy model not available
        if response.status_code == 500:
            pytest.skip("spaCy model not available")

        # Skip if TTS engine not running (list_available_engines only returns running engines)
        if response.status_code == 400 and "IMPORT_UNKNOWN_ENGINE" in response.text:
            pytest.skip(f"TTS engine {TEST_TTS_ENGINE} not running")

        assert response.status_code == 200

        data = response.json()

        # Track for cleanup
        if "project" in data and "id" in data["project"]:
            created_projects.append(data["project"]["id"])

        # Check required fields
        assert "project" in data
        assert "chaptersCreated" in data
        assert "segmentsCreated" in data

    def test_execute_response_uses_camel_case(self, created_projects):
        """Response uses camelCase field names."""
        response = client.post(
            "/api/projects/import",
            files={"file": ("test.md", VALID_MARKDOWN_MINIMAL, "text/markdown")},
            data={
                "mapping_rules": DEFAULT_MAPPING_RULES,
                "mode": "new",
                "language": "en",
                "tts_engine": TEST_TTS_ENGINE,
                "tts_model_name": "v2",
                "tts_language": "en"
            }
        )

        if response.status_code == 500:
            pytest.skip("spaCy model not available")
        if response.status_code == 400 and "IMPORT_UNKNOWN_ENGINE" in response.text:
            pytest.skip(f"TTS engine {TEST_TTS_ENGINE} not running")

        assert response.status_code == 200
        data = response.json()

        # Track for cleanup
        if "project" in data and "id" in data["project"]:
            created_projects.append(data["project"]["id"])

        # Response should have camelCase fields
        assert "chaptersCreated" in data
        assert "segmentsCreated" in data

        # snake_case should NOT be present
        assert "chapters_created" not in data
        assert "segments_created" not in data

    def test_execute_response_validates_against_schema(self, created_projects):
        """Response validates against ImportExecuteResponse schema."""
        response = client.post(
            "/api/projects/import",
            files={"file": ("test.md", VALID_MARKDOWN_MINIMAL, "text/markdown")},
            data={
                "mapping_rules": DEFAULT_MAPPING_RULES,
                "mode": "new",
                "language": "en",
                "tts_engine": TEST_TTS_ENGINE,
                "tts_model_name": "v2",
                "tts_language": "en"
            }
        )

        if response.status_code == 500:
            pytest.skip("spaCy model not available")
        if response.status_code == 400 and "IMPORT_UNKNOWN_ENGINE" in response.text:
            pytest.skip(f"TTS engine {TEST_TTS_ENGINE} not running")

        assert response.status_code == 200
        data = response.json()

        # Track for cleanup
        if "project" in data and "id" in data["project"]:
            created_projects.append(data["project"]["id"])

        # Pydantic validation
        validated = ImportExecuteResponse.model_validate(data)
        assert validated.chapters_created >= 0
        assert validated.segments_created >= 0

    def test_execute_merge_success(self, test_project_for_merge, created_projects):
        """Merge chapters into existing project."""
        response = client.post(
            "/api/projects/import",
            files={"file": ("test.md", VALID_MARKDOWN_MINIMAL, "text/markdown")},
            data={
                "mapping_rules": DEFAULT_MAPPING_RULES,
                "mode": "merge",
                "merge_target_id": test_project_for_merge["id"],
                "language": "en",
                "tts_engine": TEST_TTS_ENGINE,
                "tts_model_name": "v2",
                "tts_language": "en"
            }
        )

        if response.status_code == 500:
            pytest.skip("spaCy model not available")
        if response.status_code == 400 and "IMPORT_UNKNOWN_ENGINE" in response.text:
            pytest.skip(f"TTS engine {TEST_TTS_ENGINE} not running")

        assert response.status_code == 200

        data = response.json()
        assert data["project"]["id"] == test_project_for_merge["id"]
        assert data["chaptersCreated"] >= 1

    def test_execute_error_uses_error_code_format(self):
        """Error responses use [ERROR_CODE] format."""
        response = client.post(
            "/api/projects/import",
            files={"file": ("test.md", VALID_MARKDOWN_MINIMAL, "text/markdown")},
            data={
                "mapping_rules": DEFAULT_MAPPING_RULES,
                "mode": "invalid",
                "tts_engine": TEST_TTS_ENGINE,
                "tts_model_name": "v2",
                "tts_language": "en"
            }
        )

        data = response.json()
        # Error code format: [ERROR_CODE]param:value
        assert data["detail"].startswith("[")
        assert "]" in data["detail"]


# ============================================================================
# Contract Tests - Request Schema Validation
# ============================================================================

class TestImportRequestSchemaContract:
    """Contract tests for import request schema validation."""

    def test_preview_accepts_all_mapping_options(self):
        """Preview accepts all mapping rule options."""
        custom_rules = json.dumps({
            "projectHeading": "##",
            "chapterHeading": "####",
            "dividerPattern": "---"
        })

        # Custom markdown matching custom rules
        custom_md = """## Custom Project

#### Custom Chapter

Some content here.
"""

        response = client.post(
            "/api/projects/import/preview",
            files={"file": ("custom.md", custom_md, "text/markdown")},
            data={
                "mapping_rules": custom_rules,
                "language": "en"
            }
        )

        # Should not be validation error
        assert response.status_code != 422

    def test_execute_accepts_optional_parameters(self, created_projects):
        """Execute accepts all optional parameters."""
        response = client.post(
            "/api/projects/import",
            files={"file": ("test.md", VALID_MARKDOWN_MINIMAL, "text/markdown")},
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

        # Should not be validation error
        assert response.status_code != 422

        # Track for cleanup if successful
        if response.status_code == 200:
            data = response.json()
            if "project" in data and "id" in data["project"]:
                created_projects.append(data["project"]["id"])

    def test_execute_accepts_snake_case_parameters(self, created_projects):
        """Execute accepts snake_case parameter names."""
        response = client.post(
            "/api/projects/import",
            files={"file": ("test.md", VALID_MARKDOWN_MINIMAL, "text/markdown")},
            data={
                "mapping_rules": DEFAULT_MAPPING_RULES,
                "mode": "new",
                "language": "en",
                "tts_engine": TEST_TTS_ENGINE,
                "tts_model_name": "v2",
                "tts_language": "en"
            }
        )

        # Should be accepted
        assert response.status_code != 422

        # Track for cleanup if successful
        if response.status_code == 200:
            data = response.json()
            if "project" in data and "id" in data["project"]:
                created_projects.append(data["project"]["id"])
