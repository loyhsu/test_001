from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from .template_catalog import background_preset_ids
from .storage import SUBJECT_OBJECT_PATH_PATTERN

Speed = Literal["slow", "standard", "fast"]


class EditorState(BaseModel):
    x: float = Field(ge=0, le=480)
    y: float = Field(ge=0, le=480)
    scale: float = Field(ge=0.65, le=1.6)
    speed: Speed
    backgroundId: str = "template"

    @field_validator("backgroundId")
    @classmethod
    def validate_background_id(cls, value: str) -> str:
        if value not in background_preset_ids():
            raise ValueError("unknown background preset")
        return value


class PrepareSubjectRequest(BaseModel):
    sourceUrl: str
    subjectObjectPath: str

    @field_validator("sourceUrl")
    @classmethod
    def validate_source_url(cls, value: str) -> str:
        if not value.startswith("https://"):
            raise ValueError("sourceUrl must use HTTPS")
        return value

    @field_validator("subjectObjectPath")
    @classmethod
    def validate_subject_object_path(cls, value: str) -> str:
        if SUBJECT_OBJECT_PATH_PATTERN.fullmatch(value) is None:
            raise ValueError("subjectObjectPath must be a ticket-scoped PNG path")
        return value


class PrepareSubjectResponse(BaseModel):
    subjectFileId: str
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class GenerateRequest(BaseModel):
    requestId: str = Field(min_length=8, max_length=64)
    workId: str = Field(min_length=8, max_length=64)
    templateId: str
    sourceUrl: str | None = None
    subjectUrl: str | None = None
    reusedSubjectFileId: str | None = None
    editorState: EditorState

    @model_validator(mode="after")
    def validate_generation_source(self):
        if bool(self.sourceUrl) == bool(self.subjectUrl):
            raise ValueError("exactly one sourceUrl or subjectUrl is required")
        if self.subjectUrl and not (
            self.reusedSubjectFileId and self.reusedSubjectFileId.startswith("cloud://")
        ):
            raise ValueError("subjectUrl requires a private CloudBase subject file ID")
        if self.sourceUrl and self.reusedSubjectFileId:
            raise ValueError("reusedSubjectFileId is only valid with subjectUrl")
        return self


class GenerateResponse(BaseModel):
    resultFileId: str
    coverFileId: str
    subjectFileId: str
    outputBytes: int = Field(gt=0, le=8_388_608)
