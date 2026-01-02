"""Tests for DockerRunner - local Docker container execution."""

import pytest
from unittest.mock import Mock, patch

from core.docker_runner import DockerRunner


@pytest.fixture
def mock_docker_client():
    """Create a mock Docker client."""
    mock_client = Mock()
    mock_client.ping = Mock(return_value=True)
    mock_client.containers = Mock()
    return mock_client


@pytest.fixture
def docker_runner(mock_docker_client):
    """Create DockerRunner with mocked client."""
    with patch('docker.from_env', return_value=mock_docker_client):
        runner = DockerRunner()
        return runner


def test_docker_runner_initialization(docker_runner):
    """Test DockerRunner initializes correctly."""
    assert docker_runner.containers == {}
    assert docker_runner.endpoints == {}


def test_is_running_false_when_not_started(docker_runner):
    """Test is_running returns False for non-started containers."""
    assert docker_runner.is_running("xtts") is False


def test_get_endpoint_none_when_not_started(docker_runner):
    """Test get_endpoint returns None for non-started containers."""
    assert docker_runner.get_endpoint("xtts") is None
