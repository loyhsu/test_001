import pytest
from pydantic import ValidationError

from app.models import EditorState, GenerateRequest

EDITOR_STATE = {
    "x": 240,
    "y": 278,
    "scale": 1,
    "speed": "standard",
}


def test_rejects_scale_above_template_limit():
    with pytest.raises(ValidationError):
        GenerateRequest(
            requestId="request-123",
            workId="work-123",
            templateId="pat-head",
            sourceUrl="https://example.test/source.png",
            editorState={
                "x": 240,
                "y": 240,
                "scale": 2,
                "speed": "standard",
            },
        )


def test_accepts_a_private_reusable_subject_without_an_original_source_url():
    request = GenerateRequest.model_validate({
        "requestId": "request-123",
        "workId": "work-12345678",
        "templateId": "pat-head",
        "subjectUrl": "https://temporary.example/subject.png",
        "reusedSubjectFileId": "cloud://env/works/parent/subject.png",
        "editorState": EDITOR_STATE,
    })

    assert request.sourceUrl is None
    assert request.subjectUrl == "https://temporary.example/subject.png"


@pytest.mark.parametrize(
    "sources",
    [
        {},
        {
            "sourceUrl": "https://temporary.example/source.png",
            "subjectUrl": "https://temporary.example/subject.png",
            "reusedSubjectFileId": "cloud://env/works/parent/subject.png",
        },
        {
            "subjectUrl": "https://temporary.example/subject.png",
        },
    ],
)
def test_rejects_missing_or_ambiguous_generation_sources(sources):
    with pytest.raises(ValidationError):
        GenerateRequest.model_validate({
            "requestId": "request-123",
            "workId": "work-12345678",
            "templateId": "pat-head",
            "editorState": EDITOR_STATE,
            **sources,
        })


def test_editor_state_validates_background_id_and_keeps_template_default():
    base = {"x": 240, "y": 278, "scale": 1, "speed": "standard"}

    assert EditorState(**base).backgroundId == "template"
    for background_id in ("template", "sky-blue", "cream", "lavender"):
        assert EditorState(**base, backgroundId=background_id).backgroundId == background_id

    with pytest.raises(ValidationError):
        EditorState(**base, backgroundId="public-image-url")
