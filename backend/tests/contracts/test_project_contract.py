"""
Contract Tests for Project Endpoints
"""

import pytest
from fastapi.testclient import TestClient
from main import app
from models.response_models import ProjectResponse, DeleteResponse


client = TestClient(app)


@pytest.fixture
def test_project():
    """Create and cleanup test project."""
    response = client.post("/api/projects", json={
        "title": "Contract Test Project",
        "description": "For testing"
    })
    assert response.status_code == 200
    project = response.json()
    yield project
    client.delete(f"/api/projects/{project['id']}")


class TestProjectListContract:
    """Contract tests for GET /projects."""

    def test_list_projects_returns_200(self):
        response = client.get("/api/projects")
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    def test_list_projects_items_validate_schema(self, test_project):
        response = client.get("/api/projects")
        projects = response.json()
        assert len(projects) > 0
        for p in projects:
            ProjectResponse.model_validate(p)


class TestProjectGetContract:
    """Contract tests for GET /projects/{id}."""

    def test_get_project_returns_200(self, test_project):
        response = client.get(f"/api/projects/{test_project['id']}")
        assert response.status_code == 200

    def test_get_project_validates_schema(self, test_project):
        response = client.get(f"/api/projects/{test_project['id']}")
        validated = ProjectResponse.model_validate(response.json())
        assert validated.title == "Contract Test Project"

    def test_get_project_uses_camel_case(self, test_project):
        data = client.get(f"/api/projects/{test_project['id']}").json()
        assert "orderIndex" in data
        assert "createdAt" in data
        assert "order_index" not in data

    def test_get_project_returns_404_for_unknown(self):
        response = client.get("/api/projects/nonexistent-id")
        assert response.status_code == 404


class TestProjectCreateContract:
    """Contract tests for POST /projects."""

    def test_create_project_returns_project_response(self):
        response = client.post("/api/projects", json={
            "title": "New Project",
            "description": "Test description"
        })
        assert response.status_code == 200
        data = response.json()
        validated = ProjectResponse.model_validate(data)
        assert validated.title == "New Project"
        client.delete(f"/api/projects/{data['id']}")

    def test_create_project_sets_defaults(self):
        response = client.post("/api/projects", json={
            "title": "Defaults Test"
        })
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert "createdAt" in data
        client.delete(f"/api/projects/{data['id']}")


class TestProjectDeleteContract:
    """Contract tests for DELETE /projects/{id}."""

    def test_delete_project_returns_delete_response(self):
        create_resp = client.post("/api/projects", json={"title": "To Delete"})
        project_id = create_resp.json()["id"]

        response = client.delete(f"/api/projects/{project_id}")
        assert response.status_code == 200
        DeleteResponse.model_validate(response.json())

    def test_delete_unknown_returns_404(self):
        response = client.delete("/api/projects/nonexistent-id")
        assert response.status_code == 404
