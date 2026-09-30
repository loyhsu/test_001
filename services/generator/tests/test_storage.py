import json

import httpx
import pytest

from app.errors import GeneratorError
from app.storage import CloudBaseStorage


def test_uses_cloudbase_injected_api_key_environment_name(monkeypatch):
    for name in (
        "TCB_API_KEY",
        "CLOUDBASE_API_KEY",
        "TCB_API_BASE",
        "TCB_REGION",
        "CLOUDBASE_ENV_ID",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("TCB_ENV_ID", "test-env")
    monkeypatch.setenv("CLOUDBASE_APIKEY", "injected-secret")

    storage = CloudBaseStorage.from_environment()

    assert storage.api_key == "injected-secret"
    assert storage.api_base == "https://test-env.api.tcloudbasegateway.com"


def test_uploads_outputs_to_private_work_paths(tmp_path):
    gif = tmp_path / "result.gif"
    cover = tmp_path / "cover.jpg"
    gif.write_bytes(b"GIF89a")
    cover.write_bytes(b"cover")
    calls = []

    def respond(request):
        calls.append(request)
        if request.url.path.endswith("get-objects-upload-info"):
            object_id = json.loads(request.content)[0]["objectId"]
            return httpx.Response(
                200,
                json=[
                    {
                        "uploadUrl": f"https://upload.example/{object_id}",
                        "authorization": "signed-upload",
                        "token": "temporary-token",
                        "cloudObjectMeta": "file-meta",
                        "cloudObjectId": f"cloud://env/{object_id}",
                        "downloadUrl": "https://download.example/temporary",
                    }
                ],
            )
        if request.method == "PUT":
            return httpx.Response(200)
        raise AssertionError(f"unexpected request {request.method} {request.url}")

    client = httpx.Client(transport=httpx.MockTransport(respond))
    try:
        storage = CloudBaseStorage("https://env.api.example", "secret", client=client)
        result_id, cover_id = storage.upload_outputs(gif, cover, "work-12345678")
    finally:
        client.close()

    assert result_id == "cloud://env/works/work-12345678/result.gif"
    assert cover_id == "cloud://env/works/work-12345678/cover.jpg"
    upload_requests = [call for call in calls if call.method == "PUT"]
    assert [call.headers["content-type"] for call in upload_requests] == [
        "image/gif",
        "image/jpeg",
    ]
    assert all(call.headers["x-cos-security-token"] == "temporary-token" for call in upload_requests)


def test_uploads_new_cutout_to_its_private_work_path(tmp_path):
    gif = tmp_path / "result.gif"
    cover = tmp_path / "cover.jpg"
    subject = tmp_path / "subject.png"
    gif.write_bytes(b"GIF89a")
    cover.write_bytes(b"cover")
    subject.write_bytes(b"transparent-png")
    calls = []

    def respond(request):
        calls.append(request)
        if request.url.path.endswith("get-objects-upload-info"):
            object_id = json.loads(request.content)[0]["objectId"]
            return httpx.Response(
                200,
                json=[{
                    "uploadUrl": f"https://upload.example/{object_id}",
                    "authorization": "signed-upload",
                    "token": "temporary-token",
                    "cloudObjectMeta": "file-meta",
                    "cloudObjectId": f"cloud://env/{object_id}",
                }],
            )
        if request.method == "PUT":
            return httpx.Response(200)
        raise AssertionError(f"unexpected request {request.method} {request.url}")

    client = httpx.Client(transport=httpx.MockTransport(respond))
    try:
        storage = CloudBaseStorage("https://env.api.example", "secret", client=client)
        result = storage.upload_outputs(
            gif,
            cover,
            "work-12345678",
            subject_path=subject,
        )
    finally:
        client.close()

    assert result == (
        "cloud://env/works/work-12345678/result.gif",
        "cloud://env/works/work-12345678/cover.jpg",
        "cloud://env/works/work-12345678/subject.png",
    )
    upload_requests = [call for call in calls if call.method == "PUT"]
    assert [call.headers["content-type"] for call in upload_requests] == [
        "image/gif",
        "image/jpeg",
        "image/png",
    ]


def test_failed_cover_upload_rolls_back_both_reserved_objects(tmp_path):
    gif = tmp_path / "result.gif"
    cover = tmp_path / "cover.jpg"
    gif.write_bytes(b"GIF89a")
    cover.write_bytes(b"cover")
    deleted = []

    def respond(request):
        if request.url.path.endswith("get-objects-upload-info"):
            object_id = json.loads(request.content)[0]["objectId"]
            return httpx.Response(
                200,
                json=[
                    {
                        "uploadUrl": f"https://upload.example/{object_id}",
                        "authorization": "signed-upload",
                        "token": "temporary-token",
                        "cloudObjectMeta": "file-meta",
                        "cloudObjectId": f"cloud://env/{object_id}",
                    }
                ],
            )
        if request.method == "PUT" and request.url.path.endswith("cover.jpg"):
            return httpx.Response(500)
        if request.method == "PUT":
            return httpx.Response(200)
        if request.url.path.endswith("delete-objects"):
            deleted.extend(json.loads(request.content))
            return httpx.Response(200, json={"deleted": True})
        raise AssertionError(f"unexpected request {request.method} {request.url}")

    client = httpx.Client(transport=httpx.MockTransport(respond))
    try:
        storage = CloudBaseStorage("https://env.api.example", "secret", client=client)
        with pytest.raises(GeneratorError, match="NETWORK_ERROR"):
            storage.upload_outputs(gif, cover, "work-12345678")
    finally:
        client.close()

    assert deleted == [
        {"cloudObjectId": "cloud://env/works/work-12345678/cover.jpg"},
        {"cloudObjectId": "cloud://env/works/work-12345678/result.gif"},
    ]


def test_uploads_prepared_subject_as_private_png(tmp_path):
    subject = tmp_path / "subject.png"
    subject.write_bytes(b"transparent-png")
    calls = []

    def respond(request):
        calls.append(request)
        if request.url.path.endswith("get-objects-upload-info"):
            object_id = json.loads(request.content)[0]["objectId"]
            return httpx.Response(
                200,
                json=[{
                    "uploadUrl": f"https://upload.example/{object_id}",
                    "authorization": "signed-upload",
                    "token": "temporary-token",
                    "cloudObjectMeta": "file-meta",
                    "cloudObjectId": f"cloud://env/{object_id}",
                }],
            )
        if request.method == "PUT":
            return httpx.Response(200)
        raise AssertionError(f"unexpected request {request.method} {request.url}")

    client = httpx.Client(transport=httpx.MockTransport(respond))
    try:
        storage = CloudBaseStorage("https://env.api.example", "secret", client=client)
        file_id = storage.upload_subject(
            subject,
            "uploads/ticket-123456/request-123456/subject.png",
        )
    finally:
        client.close()

    assert file_id == "cloud://env/uploads/ticket-123456/request-123456/subject.png"
    upload_request = next(call for call in calls if call.method == "PUT")
    assert upload_request.headers["content-type"] == "image/png"
    assert upload_request.headers["x-cos-security-token"] == "temporary-token"


def test_rejects_subject_object_path_outside_upload_scope(tmp_path):
    subject = tmp_path / "subject.png"
    subject.write_bytes(b"transparent-png")
    client = httpx.Client(transport=httpx.MockTransport(
        lambda _request: pytest.fail("invalid path must be rejected before storage access")
    ))
    try:
        storage = CloudBaseStorage("https://env.api.example", "secret", client=client)
        with pytest.raises(GeneratorError, match="INVALID_INPUT"):
            storage.upload_subject(subject, "works/work-12345678/subject.png")
    finally:
        client.close()
