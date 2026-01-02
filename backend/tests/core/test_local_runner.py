"""Tests for LocalRunner - subprocess-based engine execution."""

import pytest

from core.local_runner import LocalRunner


@pytest.fixture
def mock_engines_base_path(tmp_path):
    """Create a mock engines directory structure."""
    engines_dir = tmp_path / "engines"
    engines_dir.mkdir()
    return engines_dir


@pytest.fixture
def local_runner(mock_engines_base_path):
    """Create a LocalRunner instance with mock path."""
    return LocalRunner(engines_base_path=mock_engines_base_path)


def test_local_runner_initialization(local_runner, mock_engines_base_path):
    """Test LocalRunner initializes correctly."""
    assert local_runner.engines_base_path == mock_engines_base_path
    assert local_runner.processes == {}
    assert local_runner.endpoints == {}


def test_is_running_false_when_not_started(local_runner):
    """Test is_running returns False for non-started engines."""
    assert local_runner.is_running("xtts") is False


def test_get_endpoint_none_when_not_started(local_runner):
    """Test get_endpoint returns None for non-started engines."""
    assert local_runner.get_endpoint("xtts") is None


@pytest.mark.asyncio
async def test_stop_non_running_engine_is_noop(local_runner):
    """Test stopping a non-running engine does nothing."""
    # Should not raise
    await local_runner.stop("xtts")
