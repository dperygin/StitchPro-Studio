from fastapi.testclient import TestClient

from stitchpro_server.main import app, entitled

client = TestClient(app)


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_formats():
    assert client.get("/api/formats").json()["formats"] == ["dst", "pes", "exp", "jef", "vp3", "xxx"]


def test_every_download_is_entitled_for_now():
    assert entitled({}) is True


def test_pyembroidery_available():
    import pyembroidery

    assert hasattr(pyembroidery, "write")
