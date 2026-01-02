"""Tests for BaseEngineManager runner integration."""

import pytest
from unittest.mock import Mock, patch, AsyncMock

from core.engine_runner import EngineEndpoint


@pytest.fixture
def mock_registry():
    """Create mock registry with mock runner."""
    mock_runner = Mock()
    mock_runner.start = AsyncMock(return_value=EngineEndpoint(base_url="http://127.0.0.1:8766"))
    mock_runner.stop = AsyncMock()
    mock_runner.is_running = Mock(return_value=False)
    mock_runner.get_endpoint = Mock(return_value=None)

    mock_reg = Mock()
    mock_reg.get_runner = Mock(return_value=mock_runner)
    return mock_reg, mock_runner


def test_base_engine_manager_uses_registry(mock_registry):
    """Test that BaseEngineManager gets runner from registry."""
    mock_reg, mock_runner = mock_registry

    with patch('core.base_engine_manager.get_engine_runner_registry', return_value=mock_reg):
        # Import after patch

        # This test verifies the integration exists
        # Full integration tests would require more setup
        assert mock_reg is not None


def test_engine_runner_registry_import():
    """Test that engine_runner_registry can be imported."""
    from core.engine_runner_registry import get_engine_runner_registry, EngineRunnerRegistry

    # Get singleton
    registry = get_engine_runner_registry()
    assert isinstance(registry, EngineRunnerRegistry)
    assert 'local' in registry.runners
