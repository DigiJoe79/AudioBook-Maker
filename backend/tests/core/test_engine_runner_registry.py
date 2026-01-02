"""Tests for EngineRunnerRegistry."""

import pytest
from unittest.mock import Mock

from core.engine_runner_registry import EngineRunnerRegistry
from core.engine_runner import EngineRunner


@pytest.fixture
def registry():
    """Create a fresh registry for each test."""
    return EngineRunnerRegistry()


@pytest.fixture
def mock_runner():
    """Create a mock runner."""
    return Mock(spec=EngineRunner)


def test_registry_has_local_runner_by_default(registry):
    """Test that registry initializes with 'local' runner."""
    assert 'local' in registry.runners


def test_register_runner(registry, mock_runner):
    """Test registering a new runner."""
    registry.register_runner('docker:local', mock_runner)
    assert 'docker:local' in registry.runners
    assert registry.runners['docker:local'] is mock_runner


def test_assign_engine_to_runner(registry, mock_runner):
    """Test assigning an engine to a specific runner."""
    registry.register_runner('docker:gpu', mock_runner)
    registry.assign_engine('xtts', 'docker:gpu')
    assert registry.engine_assignments['xtts'] == 'docker:gpu'


def test_assign_engine_to_unknown_runner_raises(registry):
    """Test that assigning to unknown runner raises ValueError."""
    with pytest.raises(ValueError, match="Unknown runner"):
        registry.assign_engine('xtts', 'nonexistent')


def test_get_runner_returns_assigned_runner(registry, mock_runner):
    """Test get_runner returns the assigned runner."""
    registry.register_runner('docker:gpu', mock_runner)
    registry.assign_engine('xtts', 'docker:gpu')

    runner = registry.get_runner('xtts')
    assert runner is mock_runner


def test_get_runner_returns_local_by_default(registry):
    """Test get_runner returns 'local' runner when no assignment."""
    runner = registry.get_runner('unknown_engine')
    assert runner is registry.runners['local']


class TestEngineRunnerRegistryVariants:
    """Tests for variant_id support in EngineRunnerRegistry."""

    def test_get_runner_by_variant_local(self, registry):
        """Local variant returns local runner."""
        runner = registry.get_runner_by_variant("xtts:local")
        assert runner is not None
        assert runner is registry.runners['local']

    def test_get_runner_by_variant_extracts_engine_name(self, registry, mock_runner):
        """Variant ID correctly extracts engine name for assignment lookup."""
        # Assign xtts to a different runner (if available)
        registry.register_runner('docker:local', mock_runner)
        registry.assign_engine('xtts', 'docker:local')
        runner = registry.get_runner_by_variant("xtts:docker:local")
        assert runner is mock_runner

    def test_get_runner_id_by_variant(self, registry):
        """Get runner ID from variant_id."""
        runner_id = registry.get_runner_id_by_variant("whisper:local")
        assert runner_id == "local"

    def test_get_runner_id_by_variant_docker(self, registry):
        """Docker variant extracts runner from variant_id."""
        runner_id = registry.get_runner_id_by_variant("xtts:docker:local")
        # Returns "docker:local" from the variant_id
        assert runner_id == "docker:local"
