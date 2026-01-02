"""Tests for config module."""
import os


def test_is_subprocess_available_default():
    """When DEFAULT_ENGINE_RUNNER is 'local' (default), subprocess is available."""
    # Clear any override
    os.environ.pop('DEFAULT_ENGINE_RUNNER', None)

    # Force reimport to pick up env change
    import importlib
    import config
    importlib.reload(config)

    assert config.is_subprocess_available() is True


def test_is_subprocess_available_docker_mode():
    """When DEFAULT_ENGINE_RUNNER is 'docker', subprocess is not available."""
    os.environ['DEFAULT_ENGINE_RUNNER'] = 'docker'

    import importlib
    import config
    importlib.reload(config)

    assert config.is_subprocess_available() is False

    # Cleanup
    os.environ['DEFAULT_ENGINE_RUNNER'] = 'local'
    importlib.reload(config)
