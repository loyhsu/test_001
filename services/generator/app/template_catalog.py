import json
from functools import lru_cache
from pathlib import Path
import re
from typing import Literal

from pydantic import BaseModel, Field, model_validator

ROOT = Path(__file__).resolve().parents[3]
BACKGROUND_PRESETS_PATH = ROOT / "templates" / "pat-head" / "background-presets.json"


class Canvas(BaseModel):
    width: Literal[480]
    height: Literal[480]


class Subject(BaseModel):
    defaultX: float = Field(ge=0, le=480)
    defaultY: float = Field(ge=0, le=480)
    defaultScale: float = Field(ge=0.65, le=1.6)
    minScale: Literal[0.65]
    maxScale: Literal[1.6]


class Layer(BaseModel):
    type: Literal["background", "subject", "animation"]
    asset: str | None = None

    @model_validator(mode="after")
    def validate_asset(self):
        if self.type == "subject" and self.asset is not None:
            raise ValueError("subject layer cannot define an asset")
        if self.type != "subject" and not self.asset:
            raise ValueError(f"{self.type} layer requires an asset")
        return self


class Manifest(BaseModel):
    id: str
    name: str
    category: Literal["popular", "funny", "interaction", "emotion"]
    durationMs: int = Field(ge=1200, le=4000)
    fps: int = Field(ge=10, le=20)
    canvas: Canvas
    subject: Subject
    layers: list[Layer] = Field(min_length=3)


@lru_cache
def load_catalog() -> list[Manifest]:
    catalog_path = ROOT / "templates" / "catalog.json"
    template_ids = json.loads(catalog_path.read_text(encoding="utf-8"))["templateIds"]

    if len(template_ids) != len(set(template_ids)):
        raise ValueError("catalog contains duplicate template ids")

    manifests = []
    for template_id in template_ids:
        manifest_path = ROOT / "templates" / template_id / "manifest.json"
        manifest = Manifest.model_validate_json(manifest_path.read_text(encoding="utf-8"))
        if manifest.id != template_id:
            raise ValueError(f"manifest id mismatch: {template_id} != {manifest.id}")
        manifests.append(manifest)
    return manifests


def get_template(template_id: str) -> Manifest:
    for template in load_catalog():
        if template.id == template_id:
            return template
    raise KeyError(template_id)


@lru_cache
def load_background_presets() -> dict[str, str | None]:
    try:
        config = json.loads(BACKGROUND_PRESETS_PATH.read_text(encoding="utf-8"))
        presets = config["presets"]
        ids = [preset["id"] for preset in presets]
        if len(ids) != len(set(ids)) or "template" not in ids:
            raise ValueError("background presets contain duplicate IDs or omit template")
        if len(presets) < 2:
            raise ValueError("background presets require at least one color choice")

        colors: dict[str, str | None] = {}
        for preset in presets:
            preset_id = preset["id"]
            color = preset["color"]
            if not isinstance(preset.get("label"), str) or not preset["label"].strip():
                raise ValueError(f"invalid background preset label: {preset_id}")
            if preset_id == "template":
                if color is not None:
                    raise ValueError("template background preset color must be null")
            elif not isinstance(color, str) or re.fullmatch(r"#[0-9a-fA-F]{6}", color) is None:
                raise ValueError(f"invalid background preset color: {preset_id}")
            colors[preset_id] = color
        return colors
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        raise ValueError("invalid background preset configuration") from error


def background_preset_ids() -> frozenset[str]:
    return frozenset(load_background_presets())


def get_background_color(background_id: str) -> str | None:
    try:
        return load_background_presets()[background_id]
    except KeyError:
        raise ValueError(f"unknown background preset: {background_id}") from None
