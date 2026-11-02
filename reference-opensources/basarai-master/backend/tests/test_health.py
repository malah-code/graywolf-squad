def test_health_returns_200(client):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "timestamp" in data


def test_health_no_auth_required(client):
    response = client.get("/health")
    assert response.status_code == 200
