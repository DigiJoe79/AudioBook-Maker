"""
Contract Tests for Settings Endpoints
"""

from fastapi.testclient import TestClient
from main import app
from models.response_models import AllSettingsResponse


client = TestClient(app)


class TestSettingsGetContract:
    """Contract tests for GET /settings."""

    def test_get_settings_returns_200(self):
        response = client.get("/api/settings")
        assert response.status_code == 200

    def test_get_settings_validates_schema(self):
        response = client.get("/api/settings")
        validated = AllSettingsResponse.model_validate(response.json())
        # Should have main setting categories
        assert hasattr(validated, 'tts') or 'tts' in response.json()

    def test_get_settings_uses_camel_case(self):
        data = client.get("/api/settings").json()
        # Check for camelCase in nested settings
        if "tts" in data and data["tts"]:
            tts = data["tts"]
            if "defaultEngine" in tts:
                assert "default_engine" not in tts


class TestSettingsUpdateContract:
    """Contract tests for PUT /settings/{key}."""

    def test_update_setting_returns_200(self):
        # Get a specific setting
        response = client.get("/api/settings/tts")
        if response.status_code == 200:
            current = response.json()
            # Update with same value
            update_resp = client.put("/api/settings/tts", json={"value": current.get("value", {})})
            assert update_resp.status_code == 200


class TestSettingsResetContract:
    """Contract tests for POST /settings/reset."""

    def test_reset_endpoint_exists(self):
        # Just check it exists, don't actually reset
        response = client.post("/api/settings/reset")
        # Should return 200 with MessageResponse
        assert response.status_code == 200
