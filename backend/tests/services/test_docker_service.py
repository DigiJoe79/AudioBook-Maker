"""Tests for docker_service registry functions."""
from unittest.mock import patch, MagicMock

from services.docker_service import get_remote_digest, check_image_update


class TestGetRemoteDigest:
    """Tests for get_remote_digest function."""

    def test_returns_digest_for_valid_image(self):
        """Should return sha256 digest for valid GHCR image."""
        with patch('services.docker_service.requests') as mock_requests:
            # Mock token response
            mock_token_resp = MagicMock()
            mock_token_resp.json.return_value = {"token": "test-token"}

            # Mock manifest HEAD response
            mock_head_resp = MagicMock()
            mock_head_resp.status_code = 200
            mock_head_resp.headers = {"Docker-Content-Digest": "sha256:abc123def456"}

            mock_requests.get.return_value = mock_token_resp
            mock_requests.head.return_value = mock_head_resp

            result = get_remote_digest("digijoe79/audiobook-maker-engines/xtts", "latest")

            assert result == "sha256:abc123def456"

    def test_returns_none_for_missing_image(self):
        """Should return None if image not found in registry."""
        with patch('services.docker_service.requests') as mock_requests:
            mock_token_resp = MagicMock()
            mock_token_resp.json.return_value = {"token": "test-token"}

            mock_head_resp = MagicMock()
            mock_head_resp.status_code = 404
            mock_head_resp.headers = {}

            mock_requests.get.return_value = mock_token_resp
            mock_requests.head.return_value = mock_head_resp

            result = get_remote_digest("digijoe79/nonexistent", "latest")

            assert result is None


class TestCheckImageUpdate:
    """Tests for check_image_update function."""

    def test_returns_update_available_when_digests_differ(self):
        """Should detect update when remote digest differs from local."""
        with patch('services.docker_service.get_docker_client') as mock_client, \
             patch('services.docker_service.get_remote_digest') as mock_remote:

            # Mock local image with digest
            mock_image = MagicMock()
            mock_image.attrs = {
                "RepoDigests": ["ghcr.io/digijoe79/test@sha256:localdigest123"]
            }
            mock_client.return_value.images.get.return_value = mock_image

            # Mock different remote digest
            mock_remote.return_value = "sha256:remotedigest456"

            result = check_image_update("ghcr.io/digijoe79/test", "latest")

            assert result["update_available"] is True
            # Digests are truncated to 19 chars for display ("sha256:" + 12 chars)
            assert result["local_digest"] == "sha256:localdigest1"
            assert result["remote_digest"] == "sha256:remotedigest"

    def test_returns_no_update_when_digests_match(self):
        """Should return no update when digests are identical."""
        with patch('services.docker_service.get_docker_client') as mock_client, \
             patch('services.docker_service.get_remote_digest') as mock_remote:

            mock_image = MagicMock()
            mock_image.attrs = {
                "RepoDigests": ["ghcr.io/digijoe79/test@sha256:samedigest"]
            }
            mock_client.return_value.images.get.return_value = mock_image
            mock_remote.return_value = "sha256:samedigest"

            result = check_image_update("ghcr.io/digijoe79/test", "latest")

            assert result["update_available"] is False

    def test_returns_not_installed_when_image_missing(self):
        """Should indicate not installed if local image doesn't exist."""
        with patch('services.docker_service.get_docker_client') as mock_client:
            from docker.errors import ImageNotFound
            mock_client.return_value.images.get.side_effect = ImageNotFound("not found")

            result = check_image_update("ghcr.io/digijoe79/test", "latest")

            assert result["is_installed"] is False
            assert result["update_available"] is None
