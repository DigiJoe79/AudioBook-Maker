"""
Contract Tests for Pronunciation Endpoints
"""

import pytest
from fastapi.testclient import TestClient
from main import app
from models.response_models import PronunciationRuleResponse, PronunciationRulesListResponse, MessageResponse


client = TestClient(app)


@pytest.fixture
def test_rule():
    """Create and cleanup test pronunciation rule."""
    response = client.post("/api/pronunciation/rules", json={
        "pattern": "test_pattern",
        "replacement": "test_replacement",
        "scope": "engine",
        "engineName": "xtts",
        "language": "de",
        "isRegex": False,
        "isActive": True
    })
    assert response.status_code == 201, f"Create failed: {response.json()}"
    rule = response.json()
    yield rule
    client.delete(f"/api/pronunciation/rules/{rule['id']}")


class TestPronunciationListContract:
    """Contract tests for GET /pronunciation/rules."""

    def test_list_rules_returns_200(self):
        response = client.get("/api/pronunciation/rules")
        assert response.status_code == 200

    def test_list_rules_validates_schema(self):
        response = client.get("/api/pronunciation/rules")
        validated = PronunciationRulesListResponse.model_validate(response.json())
        assert hasattr(validated, 'rules')

    def test_list_rules_uses_camel_case(self, test_rule):
        data = client.get("/api/pronunciation/rules").json()
        if data.get("rules"):
            for r in data["rules"]:
                assert "isRegex" in r
                assert "is_regex" not in r


class TestPronunciationCreateContract:
    """Contract tests for POST /pronunciation/rules."""

    def test_create_rule_returns_201(self):
        response = client.post("/api/pronunciation/rules", json={
            "pattern": "new_pattern",
            "replacement": "new_replacement",
            "scope": "engine",
            "engineName": "xtts",
            "language": "de"
        })
        assert response.status_code == 201, f"Create failed: {response.json()}"
        validated = PronunciationRuleResponse.model_validate(response.json())
        assert validated.pattern == "new_pattern"
        client.delete(f"/api/pronunciation/rules/{response.json()['id']}")


class TestPronunciationUpdateContract:
    """Contract tests for PUT /pronunciation/rules/{id}."""

    def test_update_rule_returns_200(self, test_rule):
        response = client.put(f"/api/pronunciation/rules/{test_rule['id']}", json={
            "pattern": "updated_pattern",
            "replacement": "updated_replacement"
        })
        assert response.status_code == 200, f"Update failed: {response.json()}"
        validated = PronunciationRuleResponse.model_validate(response.json())
        assert validated.pattern == "updated_pattern"


class TestPronunciationDeleteContract:
    """Contract tests for DELETE /pronunciation/rules/{id}."""

    def test_delete_rule_returns_message_response(self):
        create_resp = client.post("/api/pronunciation/rules", json={
            "pattern": "to_delete",
            "replacement": "deleted",
            "scope": "engine",
            "engineName": "xtts",
            "language": "de"
        })
        assert create_resp.status_code == 201
        rule_id = create_resp.json()["id"]

        response = client.delete(f"/api/pronunciation/rules/{rule_id}")
        assert response.status_code == 200
        MessageResponse.model_validate(response.json())


class TestPronunciationTestContract:
    """Contract tests for POST /pronunciation/rules/test."""

    def test_test_endpoint_returns_200(self):
        response = client.post("/api/pronunciation/rules/test", json={
            "text": "Hello World",
            "scope": "global"
        })
        assert response.status_code == 200
