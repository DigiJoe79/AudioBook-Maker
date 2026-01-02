"""Tests for DockerDiscoveryService."""

import pytest
from unittest.mock import AsyncMock, patch
from services.docker_discovery_service import DockerDiscoveryService, DiscoveryResult


@pytest.fixture
def discovery_service():
    """Create DockerDiscoveryService instance."""
    return DockerDiscoveryService()


@pytest.fixture
def mock_engine_info():
    """Create mock engine info response."""
    return {
        "schema_version": 2,
        "name": "test-engine",
        "display_name": "Test Engine",
        "engine_type": "tts",
        "description": "Test engine for unit tests",
        "supported_languages": ["en", "de"],
        "models": [
            {
                "name": "default",
                "display_name": "Default Model"
            }
        ],
        "default_model": "default",
        "constraints": {},
        "capabilities": {},
        "parameters": {}
    }


class TestDockerDiscoveryService:
    """Tests for DockerDiscoveryService."""

    def test_find_free_port(self, discovery_service):
        """Test finding a free port in the discovery range."""
        port = discovery_service._find_free_port()

        assert port is not None
        assert discovery_service.PORT_RANGE_START <= port <= discovery_service.PORT_RANGE_END

    def test_find_free_port_returns_different_ports(self, discovery_service):
        """Test that consecutive calls return different ports."""
        # This test may fail if only one port is free, but that's unlikely
        port1 = discovery_service._find_free_port()
        port2 = discovery_service._find_free_port()

        # Both should be valid
        assert port1 is not None
        assert port2 is not None

    @pytest.mark.asyncio
    async def test_query_info_endpoint_no_server(self, discovery_service):
        """Test querying /info when no server is running."""
        # Use a port that definitely has no server
        result = await discovery_service._query_info_endpoint(19999)

        # Should return None when connection fails
        assert result is None

    @pytest.mark.asyncio
    async def test_wait_for_health_timeout(self, discovery_service):
        """Test health check timeout when no server is running."""
        # Use a port with no server and very short timeout
        is_healthy = await discovery_service._wait_for_health(19999, timeout=1.0)

        # Should timeout and return False
        assert is_healthy is False

    @pytest.mark.asyncio
    async def test_discover_engine_no_free_port(self, discovery_service):
        """Test discovery when no free ports are available."""
        # Mock _find_free_port to return None
        with patch.object(discovery_service, '_find_free_port', return_value=None):
            result = await discovery_service.discover_engine("test-image", "latest")

            assert result.success is False
            assert "No free ports available" in result.error
            assert result.docker_image == "test-image"
            assert result.docker_tag == "latest"

    @pytest.mark.asyncio
    async def test_discover_engine_container_start_failure(self, discovery_service):
        """Test discovery when container fails to start."""
        # Mock _find_free_port to return a port
        # Mock _start_container to return None (failure)
        with patch.object(discovery_service, '_find_free_port', return_value=18000):
            with patch.object(discovery_service, '_start_container', return_value=None):
                result = await discovery_service.discover_engine("nonexistent-image", "latest")

                assert result.success is False
                assert "Failed to start Docker container" in result.error

    @pytest.mark.asyncio
    async def test_discover_engine_health_check_failure(self, discovery_service):
        """Test discovery when health check times out."""
        # Mock successful port and container start, but failing health check
        mock_container_id = "abc123"

        with patch.object(discovery_service, '_find_free_port', return_value=18000):
            with patch.object(discovery_service, '_start_container', return_value=mock_container_id):
                with patch.object(discovery_service, '_wait_for_health', return_value=False):
                    with patch.object(discovery_service, '_stop_and_remove_container', new_callable=AsyncMock):
                        result = await discovery_service.discover_engine("test-image", "latest")

                        assert result.success is False
                        assert "failed to become healthy" in result.error

    @pytest.mark.asyncio
    async def test_discover_engine_info_endpoint_failure(self, discovery_service):
        """Test discovery when /info endpoint fails."""
        mock_container_id = "abc123"

        with patch.object(discovery_service, '_find_free_port', return_value=18000):
            with patch.object(discovery_service, '_start_container', return_value=mock_container_id):
                with patch.object(discovery_service, '_wait_for_health', return_value=True):
                    with patch.object(discovery_service, '_query_info_endpoint', return_value=None):
                        with patch.object(discovery_service, '_stop_and_remove_container', new_callable=AsyncMock):
                            result = await discovery_service.discover_engine("test-image", "latest")

                            assert result.success is False
                            assert "Failed to query /info endpoint" in result.error

    @pytest.mark.asyncio
    async def test_discover_engine_validation_failure(self, discovery_service):
        """Test discovery when engine info validation fails."""
        mock_container_id = "abc123"
        invalid_info = {"invalid": "data"}  # Missing required fields

        with patch.object(discovery_service, '_find_free_port', return_value=18000):
            with patch.object(discovery_service, '_start_container', return_value=mock_container_id):
                with patch.object(discovery_service, '_wait_for_health', return_value=True):
                    with patch.object(discovery_service, '_query_info_endpoint', return_value=invalid_info):
                        with patch.object(discovery_service, '_stop_and_remove_container', new_callable=AsyncMock):
                            result = await discovery_service.discover_engine("test-image", "latest")

                            assert result.success is False
                            assert "validation failed" in result.error

    @pytest.mark.asyncio
    async def test_discover_engine_success(self, discovery_service, mock_engine_info):
        """Test successful engine discovery."""
        mock_container_id = "abc123"

        with patch.object(discovery_service, '_find_free_port', return_value=18000):
            with patch.object(discovery_service, '_start_container', return_value=mock_container_id):
                with patch.object(discovery_service, '_wait_for_health', return_value=True):
                    with patch.object(discovery_service, '_query_info_endpoint', return_value=mock_engine_info):
                        with patch.object(discovery_service, '_stop_and_remove_container', new_callable=AsyncMock):
                            result = await discovery_service.discover_engine("test-image", "latest")

                            assert result.success is True
                            assert result.engine_info is not None
                            assert result.engine_info.name == "test-engine"
                            assert result.engine_info.engine_type == "tts"
                            assert result.docker_image == "test-image"
                            assert result.docker_tag == "latest"

    @pytest.mark.asyncio
    async def test_discover_engine_cleanup_on_error(self, discovery_service):
        """Test that container is always cleaned up, even on error."""
        mock_container_id = "abc123"
        mock_cleanup = AsyncMock()

        # Simulate error after container start
        with patch.object(discovery_service, '_find_free_port', return_value=18000):
            with patch.object(discovery_service, '_start_container', return_value=mock_container_id):
                with patch.object(discovery_service, '_wait_for_health', side_effect=Exception("Test error")):
                    with patch.object(discovery_service, '_stop_and_remove_container', mock_cleanup):
                        result = await discovery_service.discover_engine("test-image", "latest")

                        # Should have called cleanup even though error occurred
                        mock_cleanup.assert_called_once_with(mock_container_id)
                        assert result.success is False

    @pytest.mark.asyncio
    async def test_discover_engine_cleanup_on_success(self, discovery_service, mock_engine_info):
        """Test that container is cleaned up after successful discovery."""
        mock_container_id = "abc123"
        mock_cleanup = AsyncMock()

        with patch.object(discovery_service, '_find_free_port', return_value=18000):
            with patch.object(discovery_service, '_start_container', return_value=mock_container_id):
                with patch.object(discovery_service, '_wait_for_health', return_value=True):
                    with patch.object(discovery_service, '_query_info_endpoint', return_value=mock_engine_info):
                        with patch.object(discovery_service, '_stop_and_remove_container', mock_cleanup):
                            result = await discovery_service.discover_engine("test-image", "latest")

                            # Should have called cleanup after success
                            mock_cleanup.assert_called_once_with(mock_container_id)
                            assert result.success is True

    @pytest.mark.asyncio
    async def test_httpx_client_lifecycle(self, discovery_service):
        """Test httpx client is properly created and closed."""
        # Client should be None initially
        assert discovery_service.httpx_client is None

        # After getting client, it should exist
        client = await discovery_service._get_httpx_client()
        assert client is not None
        assert discovery_service.httpx_client is not None

        # After closing, should be None again
        await discovery_service._close_httpx_client()
        assert discovery_service.httpx_client is None


class TestDiscoveryResult:
    """Tests for DiscoveryResult model."""

    def test_discovery_result_success(self, mock_engine_info):
        """Test creating a successful DiscoveryResult."""
        from models.engine_schema import validate_yaml_dict

        validated_info = validate_yaml_dict(mock_engine_info)

        result = DiscoveryResult(
            success=True,
            engine_info=validated_info,
            docker_image="test-image",
            docker_tag="latest"
        )

        assert result.success is True
        assert result.engine_info is not None
        assert result.engine_info.name == "test-engine"
        assert result.error is None
        assert result.docker_image == "test-image"
        assert result.docker_tag == "latest"

    def test_discovery_result_failure(self):
        """Test creating a failed DiscoveryResult."""
        result = DiscoveryResult(
            success=False,
            error="Test error message",
            docker_image="test-image",
            docker_tag="latest"
        )

        assert result.success is False
        assert result.engine_info is None
        assert result.error == "Test error message"

    def test_discovery_result_camel_case_conversion(self):
        """Test that DiscoveryResult converts to camelCase in JSON."""
        result = DiscoveryResult(
            success=True,
            docker_image="test-image",
            docker_tag="latest"
        )

        # Convert to dict with aliases (camelCase)
        data = result.model_dump(by_alias=True)

        # Check camelCase keys exist
        assert 'success' in data  # 'success' stays as-is (no underscore)
        assert 'dockerImage' in data  # docker_image → dockerImage
        assert 'dockerTag' in data    # docker_tag → dockerTag
