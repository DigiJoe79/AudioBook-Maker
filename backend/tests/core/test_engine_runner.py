"""Tests for EngineRunner abstraction."""

import pytest
from core.engine_runner import EngineEndpoint, EngineRunner


def test_engine_endpoint_creation():
    """Test EngineEndpoint dataclass creation."""
    endpoint = EngineEndpoint(base_url="http://127.0.0.1:8766")
    assert endpoint.base_url == "http://127.0.0.1:8766"
    assert endpoint.container_id is None


def test_engine_endpoint_with_container_id():
    """Test EngineEndpoint with container_id."""
    endpoint = EngineEndpoint(
        base_url="http://192.168.1.100:8766",
        container_id="abc123def456"
    )
    assert endpoint.base_url == "http://192.168.1.100:8766"
    assert endpoint.container_id == "abc123def456"


def test_engine_runner_is_abstract():
    """Test that EngineRunner cannot be instantiated directly."""
    with pytest.raises(TypeError):
        EngineRunner()
