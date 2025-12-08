"""
Contract Tests for Text Processing API Endpoints

These tests verify that Text Processing API responses match expected schemas
and handle validation errors correctly.
"""

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


# ============================================================================
# Contract Tests - POST /api/text/segment
# ============================================================================

class TestSegmentTextRequestContract:
    """Contract tests for POST /api/text/segment request validation."""

    def test_segment_text_returns_422_for_missing_text(self):
        """Missing required 'text' field returns 422."""
        response = client.post("/api/text/segment", json={
            "method": "smart",
            "language": "de"
        })
        assert response.status_code == 422

    def test_segment_text_returns_422_for_wrong_type(self):
        """Wrong type for field returns 422."""
        response = client.post("/api/text/segment", json={
            "text": 12345,  # Should be string
            "method": "smart"
        })
        assert response.status_code == 422

    def test_segment_text_returns_422_for_invalid_method(self):
        """Invalid method value returns 422."""
        response = client.post("/api/text/segment", json={
            "text": "Test text",
            "method": "invalid_method"  # Not in Literal["sentences", "paragraphs", "smart", "length"]
        })
        assert response.status_code == 422

    def test_segment_text_accepts_valid_methods(self):
        """All valid method values are accepted (no 422)."""
        valid_methods = ["sentences", "paragraphs", "smart", "length"]

        for method in valid_methods:
            response = client.post("/api/text/segment", json={
                "text": "Dies ist ein Test.",
                "method": method
            })
            # Should not be validation error (might be 400/500 if no engine)
            assert response.status_code != 422, f"Method '{method}' was rejected with 422"

    def test_segment_text_accepts_all_optional_fields(self):
        """Request with all optional fields is accepted."""
        response = client.post("/api/text/segment", json={
            "text": "Dies ist ein Test-Text für Segmentierung.",
            "method": "smart",
            "language": "de",
            "engineName": "spacy",
            "minLength": 50,
            "maxLength": 500
        })

        # Should not be validation error
        assert response.status_code != 422

    def test_segment_text_accepts_snake_case_fields(self):
        """Request with snake_case fields also works."""
        response = client.post("/api/text/segment", json={
            "text": "Dies ist ein Test.",
            "method": "smart",
            "engine_name": "spacy",
            "min_length": 50,
            "max_length": 500
        })

        # Should not be validation error
        assert response.status_code != 422


# ============================================================================
# Contract Tests - Error Responses
# ============================================================================

class TestSegmentTextErrorContract:
    """Contract tests for error responses."""

    def test_no_engine_available_error_format(self):
        """No engine available error uses error code format."""
        # This test depends on whether engines are configured
        # If no text engine is available, should return proper error code
        response = client.post("/api/text/segment", json={
            "text": "Test text",
            "method": "smart",
            "engineName": "nonexistent-engine"
        })

        if response.status_code == 400:
            data = response.json()
            assert "detail" in data
            # Should be either TEXT_ENGINE_NOT_FOUND or TEXT_NO_ENGINE_AVAILABLE
            assert data["detail"].startswith("[")
            assert "]" in data["detail"]

    def test_engine_not_found_error_includes_name(self):
        """Engine not found error includes engine name."""
        response = client.post("/api/text/segment", json={
            "text": "Test text",
            "engineName": "my-custom-engine"
        })

        if response.status_code == 400:
            data = response.json()
            if "TEXT_ENGINE_NOT_FOUND" in data["detail"]:
                assert "engine:my-custom-engine" in data["detail"]


# ============================================================================
# Contract Tests - Response Schema
# ============================================================================

class TestSegmentTextResponseContract:
    """Contract tests for response schema validation."""

    def test_response_has_required_fields_on_success(self):
        """Successful response has all required fields."""
        response = client.post("/api/text/segment", json={
            "text": "Dies ist ein Test. Und noch ein Satz.",
            "method": "paragraphs"  # Paragraphs doesn't need engine
        })

        # If engine available
        if response.status_code == 200:
            data = response.json()

            # Required fields
            assert "success" in data
            assert "method" in data
            assert "language" in data
            assert "segmentCount" in data
            assert "segments" in data

            # snake_case should NOT be present
            assert "segment_count" not in data

    def test_response_uses_camel_case(self):
        """Response uses camelCase field names."""
        response = client.post("/api/text/segment", json={
            "text": "Test paragraph one.\n\nTest paragraph two.",
            "method": "paragraphs"
        })

        if response.status_code == 200:
            data = response.json()

            # camelCase fields
            expected_camel = ["success", "method", "language", "segmentCount", "segments"]
            for field in expected_camel:
                assert field in data, f"Expected camelCase field '{field}' not found"

            # No snake_case
            forbidden_snake = ["segment_count"]
            for field in forbidden_snake:
                assert field not in data, f"Unexpected snake_case field '{field}' found"

    def test_segments_is_list_of_strings(self):
        """Segments field is a list of strings."""
        response = client.post("/api/text/segment", json={
            "text": "Paragraph eins.\n\nParagraph zwei.\n\nParagraph drei.",
            "method": "paragraphs"
        })

        if response.status_code == 200:
            data = response.json()

            assert isinstance(data["segments"], list)
            for segment in data["segments"]:
                assert isinstance(segment, str)

    def test_segment_count_matches_segments_length(self):
        """segmentCount matches actual segments list length."""
        response = client.post("/api/text/segment", json={
            "text": "Eins.\n\nZwei.\n\nDrei.",
            "method": "paragraphs"
        })

        if response.status_code == 200:
            data = response.json()
            assert data["segmentCount"] == len(data["segments"])


# ============================================================================
# Contract Tests - Paragraph Method (Engine-Independent)
# ============================================================================

class TestParagraphMethodContract:
    """Contract tests for paragraph method (doesn't require NLP engine)."""

    def test_paragraph_method_splits_on_double_newline(self):
        """Paragraph method splits text on double newlines."""
        response = client.post("/api/text/segment", json={
            "text": "Paragraph eins.\n\nParagraph zwei.\n\nParagraph drei.",
            "method": "paragraphs"
        })

        # Paragraphs method uses regex, should work without engine
        if response.status_code == 200:
            data = response.json()
            assert data["success"]
            assert data["method"] == "paragraphs"
            assert len(data["segments"]) == 3

    def test_paragraph_method_handles_empty_paragraphs(self):
        """Paragraph method filters out empty paragraphs."""
        response = client.post("/api/text/segment", json={
            "text": "Paragraph eins.\n\n\n\nParagraph zwei.",
            "method": "paragraphs"
        })

        if response.status_code == 200:
            data = response.json()
            # Empty paragraphs should be filtered
            for segment in data["segments"]:
                assert segment.strip() != ""

    def test_paragraph_method_preserves_text_content(self):
        """Paragraph method preserves text content."""
        input_text = "Erster Absatz mit Text.\n\nZweiter Absatz."
        response = client.post("/api/text/segment", json={
            "text": input_text,
            "method": "paragraphs"
        })

        if response.status_code == 200:
            data = response.json()
            assert "Erster Absatz" in data["segments"][0]
            assert "Zweiter Absatz" in data["segments"][1]
