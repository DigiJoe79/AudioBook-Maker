"""
Unit tests for core/exceptions.py

Tests the ApplicationError class for proper error code formatting for frontend i18n.
"""
import pytest
from core.exceptions import ApplicationError


class TestApplicationError:
    """Test ApplicationError class."""

    def test_str_with_params(self):
        """Error with params formats as [CODE]param1:value1;param2:value2"""
        error = ApplicationError("TEST_CODE", foo="bar", baz="qux")
        result = str(error)
        assert result.startswith("[TEST_CODE]")
        assert "foo:bar" in result
        assert "baz:qux" in result

    def test_str_without_params(self):
        """Error without params formats as [CODE]"""
        error = ApplicationError("TEST_CODE")
        assert str(error) == "[TEST_CODE]"

    def test_default_status_code(self):
        """Default status code is 400."""
        error = ApplicationError("TEST_CODE")
        assert error.status_code == 400

    def test_custom_status_code(self):
        """Status code can be customized."""
        error = ApplicationError("TEST_CODE", status_code=503)
        assert error.status_code == 503

    def test_detail_property(self):
        """detail property returns same as str() for HTTPException compatibility."""
        error = ApplicationError("TEST_CODE", foo="bar")
        assert error.detail == str(error)

    def test_exception_inheritance(self):
        """ApplicationError is an Exception."""
        error = ApplicationError("TEST_CODE")
        assert isinstance(error, Exception)

    def test_can_be_raised(self):
        """ApplicationError can be raised and caught."""
        with pytest.raises(ApplicationError) as exc_info:
            raise ApplicationError("TEST_CODE", status_code=400)
        assert exc_info.value.code == "TEST_CODE"


class TestCommonErrorPatterns:
    """Test common error patterns used throughout the application."""

    def test_import_no_chapters_error(self):
        """IMPORT_NO_CHAPTERS formats correctly."""
        error = ApplicationError(
            "IMPORT_NO_CHAPTERS",
            status_code=400,
            projectHeading="#",
            chapterHeading="##"
        )
        assert str(error) == "[IMPORT_NO_CHAPTERS]projectHeading:#;chapterHeading:##"
        assert error.status_code == 400
        assert error.code == "IMPORT_NO_CHAPTERS"

    def test_import_no_project_title_error(self):
        """IMPORT_NO_PROJECT_TITLE formats correctly."""
        error = ApplicationError(
            "IMPORT_NO_PROJECT_TITLE",
            status_code=400,
            projectHeading="#"
        )
        assert str(error) == "[IMPORT_NO_PROJECT_TITLE]projectHeading:#"
        assert error.status_code == 400

    def test_epub_file_empty_error(self):
        """EPUB_IMPORT_FILE_EMPTY formats correctly."""
        error = ApplicationError("EPUB_IMPORT_FILE_EMPTY", status_code=400)
        assert str(error) == "[EPUB_IMPORT_FILE_EMPTY]"
        assert error.status_code == 400

    def test_epub_no_chapters_error(self):
        """EPUB_IMPORT_NO_CHAPTERS formats correctly."""
        error = ApplicationError("EPUB_IMPORT_NO_CHAPTERS", status_code=400)
        assert str(error) == "[EPUB_IMPORT_NO_CHAPTERS]"
        assert error.status_code == 400

    def test_docker_host_not_connected_error(self):
        """DOCKER_HOST_NOT_CONNECTED formats correctly."""
        error = ApplicationError(
            "DOCKER_HOST_NOT_CONNECTED",
            status_code=503,
            hostId="my-host"
        )
        assert str(error) == "[DOCKER_HOST_NOT_CONNECTED]hostId:my-host"
        assert error.status_code == 503

    def test_docker_not_available_error(self):
        """DOCKER_NOT_AVAILABLE formats correctly."""
        error = ApplicationError(
            "DOCKER_NOT_AVAILABLE",
            status_code=503,
            error="daemon not running"
        )
        assert "[DOCKER_NOT_AVAILABLE]" in str(error)
        assert "error:daemon not running" in str(error)
        assert error.status_code == 503

    def test_docker_client_creation_failed_error(self):
        """DOCKER_CLIENT_CREATION_FAILED formats correctly."""
        error = ApplicationError(
            "DOCKER_CLIENT_CREATION_FAILED",
            status_code=503,
            host="remote-host",
            error="SSH failed"
        )
        result = str(error)
        assert "[DOCKER_CLIENT_CREATION_FAILED]" in result
        assert "host:remote-host" in result
        assert "error:SSH failed" in result
        assert error.status_code == 503

    def test_ssh_key_generation_failed_error(self):
        """SSH_KEY_GENERATION_FAILED formats correctly."""
        error = ApplicationError(
            "SSH_KEY_GENERATION_FAILED",
            status_code=500,
            error="permission denied"
        )
        assert "[SSH_KEY_GENERATION_FAILED]" in str(error)
        assert "error:permission denied" in str(error)
        assert error.status_code == 500

    def test_engine_not_found_error(self):
        """ENGINE_NOT_FOUND formats correctly."""
        error = ApplicationError(
            "ENGINE_NOT_FOUND",
            status_code=404,
            engine="xtts",
            type="tts"
        )
        result = str(error)
        assert "[ENGINE_NOT_FOUND]" in result
        assert "engine:xtts" in result
        assert "type:tts" in result
        assert error.status_code == 404

    def test_segment_not_found_error(self):
        """SEGMENT_NOT_FOUND formats correctly."""
        error = ApplicationError(
            "SEGMENT_NOT_FOUND",
            status_code=404,
            segmentId="abc123"
        )
        assert str(error) == "[SEGMENT_NOT_FOUND]segmentId:abc123"
        assert error.status_code == 404


class TestStatusCodeVariants:
    """Test different status code scenarios."""

    def test_400_bad_request(self):
        """400 status for validation errors."""
        error = ApplicationError("INVALID_INPUT", status_code=400)
        assert error.status_code == 400

    def test_404_not_found(self):
        """404 status for not found errors."""
        error = ApplicationError("PROJECT_NOT_FOUND", status_code=404)
        assert error.status_code == 404

    def test_409_conflict(self):
        """409 status for conflict errors."""
        error = ApplicationError("ENGINE_ALREADY_EXISTS", status_code=409)
        assert error.status_code == 409

    def test_500_internal_error(self):
        """500 status for internal server errors."""
        error = ApplicationError("INTERNAL_ERROR", status_code=500)
        assert error.status_code == 500

    def test_503_service_unavailable(self):
        """503 status for service unavailable errors."""
        error = ApplicationError("DOCKER_NOT_AVAILABLE", status_code=503)
        assert error.status_code == 503
