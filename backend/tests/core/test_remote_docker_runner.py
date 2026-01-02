"""Tests for RemoteDockerRunner - remote Docker via SSH."""

import pytest
from unittest.mock import Mock, patch

from core.remote_docker_runner import RemoteDockerRunner


@pytest.fixture
def mock_docker_client():
    """Create a mock Docker client."""
    mock_client = Mock()
    mock_client.ping = Mock(return_value=True)
    mock_client.containers = Mock()
    mock_client.info = Mock(return_value={'ServerVersion': '24.0.0'})
    return mock_client


def test_extract_host_from_ssh_url():
    """Test extracting hostname from SSH URL."""
    with patch('docker.DockerClient') as mock_docker:
        mock_docker.return_value.ping = Mock(return_value=True)
        mock_docker.return_value.info = Mock(return_value={'ServerVersion': '24.0.0'})

        runner = RemoteDockerRunner(
            host_url="ssh://user@192.168.1.100",
            host_name="GPU Server"
        )

        assert runner._get_host_ip() == "192.168.1.100"


def test_remote_runner_initialization():
    """Test RemoteDockerRunner initializes correctly."""
    with patch('docker.DockerClient') as mock_docker:
        mock_docker.return_value.ping = Mock(return_value=True)
        mock_docker.return_value.info = Mock(return_value={'ServerVersion': '24.0.0'})

        runner = RemoteDockerRunner(
            host_url="ssh://user@192.168.1.100",
            host_name="GPU Server"
        )

        assert runner.host_url == "ssh://user@192.168.1.100"
        assert runner.host_name == "GPU Server"
