from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.compositor import ComposeResult
from app.errors import GeneratorError
from app.main import app, generate_and_store, prepare_subject_and_store
from app.models import GenerateRequest, PrepareSubjectRequest


@pytest.fixture
def request_body():
    return {
        "requestId": "request-123",
        "workId": "work-12345678",
        "templateId": "pat-head",
        "sourceUrl": "https://temporary.example/source.png",
        "editorState": {"x": 240, "y": 278, "scale": 1, "speed": "standard"},
    }


def make_png(image):
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def test_generation_route_requires_internal_token(monkeypatch, request_body):
    import app.main as main

    monkeypatch.setattr(main, "INTERNAL_TOKEN", "test-secret")
    client = TestClient(app)

    response = client.post("/v1/generate", json=request_body)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


def test_generation_route_returns_generate_response(monkeypatch, request_body):
    import app.main as main

    monkeypatch.setattr(main, "INTERNAL_TOKEN", "test-secret")
    monkeypatch.setattr(
        main,
        "generate_and_store",
        lambda _request: {
            "resultFileId": "cloud://env/works/work-12345678/result.gif",
            "coverFileId": "cloud://env/works/work-12345678/cover.jpg",
            "subjectFileId": "cloud://env/works/work-12345678/subject.png",
            "outputBytes": 2048,
        },
    )
    client = TestClient(app)

    response = client.post(
        "/v1/generate",
        headers={
            "Authorization": "TC3-HMAC-SHA256 sdk-signature",
            "X-Generator-Token": "test-secret",
        },
        json=request_body,
    )

    assert response.status_code == 200
    assert response.json()["outputBytes"] == 2048
    assert response.json()["subjectFileId"] == "cloud://env/works/work-12345678/subject.png"


def test_generation_route_preserves_stable_failure_code(monkeypatch, request_body):
    import app.main as main

    monkeypatch.setattr(main, "INTERNAL_TOKEN", "test-secret")

    def fail_generation(_request):
        raise GeneratorError("INVALID_IMAGE")

    monkeypatch.setattr(main, "generate_and_store", fail_generation)
    response = TestClient(app).post(
        "/v1/generate",
        headers={"X-Generator-Token": "test-secret"},
        json=request_body,
    )

    assert response.status_code == 400
    assert response.json() == {"error": {"code": "INVALID_IMAGE"}}


def test_health_route_returns_ok():
    response = TestClient(app).get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_prepare_subject_route_requires_internal_token(monkeypatch):
    import app.main as main

    monkeypatch.setattr(main, "INTERNAL_TOKEN", "test-secret")
    response = TestClient(app).post(
        "/v1/prepare-subject",
        json={
            "sourceUrl": "https://temporary.example/source.png",
            "subjectObjectPath": "uploads/ticket-123456/request-123456/subject.png",
        },
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


def test_prepare_subject_route_accepts_internal_header_with_sdk_signature(monkeypatch):
    import app.main as main

    monkeypatch.setattr(main, "INTERNAL_TOKEN", "test-secret")
    monkeypatch.setattr(
        main,
        "prepare_subject_and_store",
        lambda _request: {
            "subjectFileId": "cloud://env/uploads/ticket-123456/request-123456/subject.png",
            "width": 320,
            "height": 240,
        },
    )
    response = TestClient(app).post(
        "/v1/prepare-subject",
        headers={
            "Authorization": "TC3-HMAC-SHA256 sdk-signature",
            "X-Generator-Token": "test-secret",
        },
        json={
            "sourceUrl": "https://temporary.example/source.png",
            "subjectObjectPath": "uploads/ticket-123456/request-123456/subject.png",
        },
    )

    assert response.status_code == 200
    assert response.json()["width"] == 320


def test_prepare_subject_crops_alpha_bounds_and_returns_metadata(tmp_path):
    source = make_png(Image.new("RGB", (480, 480), (80, 90, 100)))
    cutout = Image.new("RGBA", (80, 60), (0, 0, 0, 0))
    for x in range(10, 70):
        for y in range(5, 50):
            cutout.putpixel((x, y), (230, 120, 40, 255))

    class FakeMatting:
        def extract_subject(self, image):
            assert image.size == (480, 480)
            return make_png(cutout)

    class FakeStorage:
        def upload_subject(self, subject_path, object_path):
            assert object_path == "uploads/ticket-123456/request-123456/subject.png"
            self.image = Image.open(subject_path).convert("RGBA")
            self.object_path = object_path
            return f"cloud://env/{object_path}"

    storage = FakeStorage()
    response = prepare_subject_and_store(
        PrepareSubjectRequest(
            sourceUrl="https://temporary.example/source.png",
            subjectObjectPath="uploads/ticket-123456/request-123456/subject.png",
        ),
        workspace_root=tmp_path,
        source_fetcher=lambda _url: (source, "image/png"),
        matting_provider=FakeMatting(),
        storage=storage,
    )

    assert response.subjectFileId == "cloud://env/uploads/ticket-123456/request-123456/subject.png"
    assert (response.width, response.height) == (60, 45)
    assert storage.image.size == (60, 45)
    assert storage.image.getchannel("A").getbbox() == (0, 0, 60, 45)


def test_prepare_subject_rejects_missing_subject(tmp_path):
    source = make_png(Image.new("RGB", (480, 480), (80, 90, 100)))

    class NoSubjectMatting:
        def extract_subject(self, _image):
            return make_png(Image.new("RGBA", (80, 60), (0, 0, 0, 0)))

    class StorageMustNotRun:
        def upload_subject(self, *_args):
            raise AssertionError("empty transparent image must not be uploaded")

    with pytest.raises(GeneratorError, match="SUBJECT_NOT_FOUND"):
        prepare_subject_and_store(
            PrepareSubjectRequest(
                sourceUrl="https://temporary.example/source.png",
                subjectObjectPath="uploads/ticket-123456/request-123456/subject.png",
            ),
            workspace_root=tmp_path,
            source_fetcher=lambda _url: (source, "image/png"),
            matting_provider=NoSubjectMatting(),
            storage=StorageMustNotRun(),
        )


def test_request_workspace_is_removed_when_storage_fails(tmp_path, request_body):
    captured_paths = []
    source = BytesIO()
    Image.new("RGB", (480, 480), (80, 90, 100)).save(source, format="PNG")

    class FakeMatting:
        def extract_subject(self, image):
            assert image.mode == "RGBA"
            return b"subject-png"

    def fake_fetch(_url):
        return source.getvalue(), "image/png"

    def fake_compose(*, subject_png, template_id, editor_state, output_dir):
        assert subject_png.read_bytes() == b"subject-png"
        gif = output_dir / "result.gif"
        cover = output_dir / "cover.jpg"
        gif.write_bytes(b"gif")
        cover.write_bytes(b"jpg")
        captured_paths.extend([subject_png, gif, cover])
        return ComposeResult(gif=gif, cover=cover)

    class BrokenStorage:
        def upload_outputs(self, *_args, **_kwargs):
            raise RuntimeError("storage offline")

    with pytest.raises(GeneratorError, match="NETWORK_ERROR"):
        generate_and_store(
            GenerateRequest.model_validate(request_body),
            workspace_root=tmp_path,
            source_fetcher=fake_fetch,
            matting_provider=FakeMatting(),
            compose_fn=fake_compose,
            storage=BrokenStorage(),
            template_validator=lambda _template_id: None,
        )

    assert len(captured_paths) == 3
    assert all(not path.exists() for path in captured_paths)


def test_reused_subject_skips_matting_and_keeps_the_original_private_file_id(tmp_path, request_body):
    source = BytesIO()
    Image.new("RGBA", (480, 480), (80, 90, 100, 128)).save(source, format="PNG")
    reused_subject_id = "cloud://env/works/parent/subject.png"
    reused_request = GenerateRequest.model_validate({
        **{key: value for key, value in request_body.items() if key != "sourceUrl"},
        "subjectUrl": "https://temporary.example/subject.png",
        "reusedSubjectFileId": reused_subject_id,
    })
    fetched_urls = []
    composition = []
    upload = []

    class MattingMustNotRun:
        def extract_subject(self, _image):
            raise AssertionError("reused transparent subjects must not be matted again")

    class ReuseStorage:
        def upload_outputs(
            self,
            gif_path,
            cover_path,
            work_id,
            *,
            subject_path,
            reused_subject_file_id=None,
        ):
            upload.append((gif_path.exists(), cover_path.exists(), subject_path.exists(), work_id))
            assert reused_subject_file_id == reused_subject_id
            return "cloud://env/result.gif", "cloud://env/cover.jpg", reused_subject_file_id

    def fetch(url):
        fetched_urls.append(url)
        return source.getvalue(), "image/png"

    def compose(*, subject_png, template_id, editor_state, output_dir):
        composition.append(subject_png.read_bytes())
        gif = output_dir / "result.gif"
        cover = output_dir / "cover.jpg"
        gif.write_bytes(b"GIF89a")
        cover.write_bytes(b"cover")
        return ComposeResult(gif=gif, cover=cover)

    generated = generate_and_store(
        reused_request,
        workspace_root=tmp_path,
        source_fetcher=fetch,
        matting_provider=MattingMustNotRun(),
        compose_fn=compose,
        storage=ReuseStorage(),
        template_validator=lambda _template_id: None,
    )

    assert fetched_urls == ["https://temporary.example/subject.png"]
    assert len(composition) == 1
    assert upload == [(True, True, True, "work-12345678")]
    assert generated.subjectFileId == reused_subject_id
