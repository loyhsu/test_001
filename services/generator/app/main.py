import hmac
from io import BytesIO
import os
from pathlib import Path
from contextlib import contextmanager
import tempfile
from typing import Callable

import httpx
from fastapi import FastAPI, Header
from fastapi.responses import JSONResponse
from PIL import Image

from .compositor import ComposeResult, compose, validate_template_assets
from .errors import GeneratorError
from .image_validation import MAX_UPLOAD_BYTES, validate_image
from .matting import RembgMattingProvider
from .models import (
    GenerateRequest,
    GenerateResponse,
    PrepareSubjectRequest,
    PrepareSubjectResponse,
)
from .storage import CloudBaseStorage, SUBJECT_OBJECT_PATH_PATTERN, WORK_ID_PATTERN

app = FastAPI(title="Expression Workshop Generator", version="0.1.0")
INTERNAL_TOKEN = os.getenv("GENERATOR_INTERNAL_TOKEN", "")
DOWNLOAD_TIMEOUT = httpx.Timeout(20, read=45)


@contextmanager
def request_workspace(workspace_root: Path | None = None):
    if workspace_root is not None:
        Path(workspace_root).mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix="expression-work-",
        dir=workspace_root,
    ) as temp_dir:
        yield Path(temp_dir)


def download_source_image(source_url: str) -> tuple[bytes, str]:
    if not source_url.startswith("https://"):
        raise GeneratorError("INVALID_IMAGE")
    try:
        with httpx.Client(timeout=DOWNLOAD_TIMEOUT, follow_redirects=False) as client:
            with client.stream("GET", source_url) as response:
                response.raise_for_status()
                content_type = response.headers.get("content-type", "")
                content_length = response.headers.get("content-length")
                if content_length and int(content_length) > MAX_UPLOAD_BYTES:
                    raise GeneratorError("IMAGE_TOO_LARGE")
                chunks = []
                total = 0
                for chunk in response.iter_bytes():
                    total += len(chunk)
                    if total > MAX_UPLOAD_BYTES:
                        raise GeneratorError("IMAGE_TOO_LARGE")
                    chunks.append(chunk)
                return b"".join(chunks), content_type
    except GeneratorError:
        raise
    except Exception:
        raise GeneratorError("NETWORK_ERROR") from None


def generate_and_store(
    request: GenerateRequest,
    *,
    workspace_root: Path | None = None,
    source_fetcher: Callable = download_source_image,
    matting_provider=None,
    compose_fn: Callable = compose,
    storage: CloudBaseStorage | None = None,
    template_validator: Callable = validate_template_assets,
) -> GenerateResponse:
    try:
        if not WORK_ID_PATTERN.fullmatch(request.workId):
            raise GeneratorError("INVALID_INPUT")
        template_validator(request.templateId)
        adapter = storage or CloudBaseStorage.from_environment()
        with request_workspace(workspace_root) as workspace:
            image_url = request.subjectUrl or request.sourceUrl
            payload, content_type = source_fetcher(image_url)
            image = validate_image(payload, content_type)
            if request.subjectUrl:
                alpha_min, _ = image.getchannel("A").getextrema()
                if alpha_min == 255:
                    raise GeneratorError("INVALID_IMAGE")
                png_buffer = BytesIO()
                image.save(png_buffer, format="PNG")
                subject_png = png_buffer.getvalue()
                reused_subject_file_id = request.reusedSubjectFileId
            else:
                provider = matting_provider or RembgMattingProvider()
                subject_png = provider.extract_subject(image)
                reused_subject_file_id = None
            subject_path = workspace / "subject.png"
            subject_path.write_bytes(subject_png)
            composed: ComposeResult = compose_fn(
                subject_png=subject_path,
                template_id=request.templateId,
                editor_state=request.editorState,
                output_dir=workspace,
            )
            output_bytes = composed.gif.stat().st_size
            if not 0 < output_bytes <= 8_388_608:
                raise GeneratorError("ENCODING_FAILED")

            try:
                result_id, cover_id, subject_id = adapter.upload_outputs(
                    composed.gif,
                    composed.cover,
                    request.workId,
                    subject_path=subject_path,
                    reused_subject_file_id=reused_subject_file_id,
                )
            except GeneratorError:
                raise
            except Exception:
                raise GeneratorError("NETWORK_ERROR") from None
            return GenerateResponse(
                resultFileId=result_id,
                coverFileId=cover_id,
                subjectFileId=subject_id,
                outputBytes=output_bytes,
            )
    except GeneratorError:
        raise
    except Exception:
        raise GeneratorError("NETWORK_ERROR") from None


def prepare_subject_and_store(
    request: PrepareSubjectRequest,
    *,
    workspace_root: Path | None = None,
    source_fetcher: Callable = download_source_image,
    matting_provider=None,
    storage: CloudBaseStorage | None = None,
) -> PrepareSubjectResponse:
    try:
        if SUBJECT_OBJECT_PATH_PATTERN.fullmatch(request.subjectObjectPath) is None:
            raise GeneratorError("INVALID_INPUT")
        adapter = storage or CloudBaseStorage.from_environment()
        with request_workspace(workspace_root) as workspace:
            payload, content_type = source_fetcher(request.sourceUrl)
            image = validate_image(payload, content_type)
            provider = matting_provider or RembgMattingProvider()
            cutout_bytes = provider.extract_subject(image)
            try:
                with Image.open(BytesIO(cutout_bytes)) as cutout_image:
                    subject = cutout_image.convert("RGBA").copy()
            except Exception:
                raise GeneratorError("MATTING_FAILED") from None

            alpha = subject.getchannel("A")
            bounds = alpha.getbbox()
            alpha_min, _ = alpha.getextrema()
            if bounds is None or alpha_min == 255:
                raise GeneratorError("SUBJECT_NOT_FOUND")
            subject = subject.crop(bounds)
            subject_path = workspace / "subject.png"
            subject.save(subject_path, format="PNG")
            file_id = adapter.upload_subject(subject_path, request.subjectObjectPath)
            return PrepareSubjectResponse(
                subjectFileId=file_id,
                width=subject.width,
                height=subject.height,
            )
    except GeneratorError:
        raise
    except Exception:
        raise GeneratorError("NETWORK_ERROR") from None


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/v1/generate", response_model=GenerateResponse)
def generate(request: GenerateRequest, x_generator_token: str | None = Header(default=None)):
    if not INTERNAL_TOKEN or not x_generator_token or not hmac.compare_digest(
        x_generator_token, INTERNAL_TOKEN
    ):
        return JSONResponse(
            status_code=401,
            content={"error": {"code": "UNAUTHENTICATED"}},
        )
    try:
        return generate_and_store(request)
    except GeneratorError as error:
        status_code = 400 if error.code in {
            "INVALID_IMAGE",
            "IMAGE_TOO_LARGE",
            "IMAGE_TOO_SMALL",
            "SUBJECT_NOT_FOUND",
            "INVALID_INPUT",
        } else 502
        return JSONResponse(
            status_code=status_code,
            content={"error": {"code": error.code}},
        )


@app.post("/v1/prepare-subject", response_model=PrepareSubjectResponse)
def prepare_subject(
    request: PrepareSubjectRequest,
    x_generator_token: str | None = Header(default=None),
):
    if not INTERNAL_TOKEN or not x_generator_token or not hmac.compare_digest(
        x_generator_token, INTERNAL_TOKEN
    ):
        return JSONResponse(
            status_code=401,
            content={"error": {"code": "UNAUTHENTICATED"}},
        )
    try:
        return prepare_subject_and_store(request)
    except GeneratorError as error:
        status_code = 400 if error.code in {
            "INVALID_IMAGE",
            "IMAGE_TOO_LARGE",
            "IMAGE_TOO_SMALL",
            "SUBJECT_NOT_FOUND",
            "INVALID_INPUT",
        } else 502
        return JSONResponse(
            status_code=status_code,
            content={"error": {"code": error.code}},
        )
