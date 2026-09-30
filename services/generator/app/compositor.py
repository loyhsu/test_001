from dataclasses import dataclass
from io import BytesIO
import math
from pathlib import Path
import subprocess

from PIL import Image
import imageio_ffmpeg

from .errors import GeneratorError
from .models import EditorState
from .template_catalog import Manifest, ROOT, get_background_color, get_template

TEMPLATE_ROOT = ROOT / "templates"
OUTPUT_LIMIT_BYTES = 8_388_608
SPEED_MULTIPLIERS = {"slow": 0.8, "standard": 1.0, "fast": 1.25}


@dataclass(frozen=True)
class ComposeResult:
    gif: Path
    cover: Path


def _template_assets(manifest: Manifest) -> tuple[Path, Path]:
    if [layer.type for layer in manifest.layers] != ["background", "subject", "animation"]:
        raise GeneratorError("ENCODING_FAILED")

    template_dir = (TEMPLATE_ROOT / manifest.id).resolve()
    assets = []
    for layer in (manifest.layers[0], manifest.layers[2]):
        asset = (template_dir / layer.asset).resolve()
        if template_dir not in asset.parents or not asset.is_file():
            raise GeneratorError("ENCODING_FAILED")
        assets.append(asset)
    return assets[0], assets[1]


def validate_template_assets(template_id: str) -> None:
    try:
        _template_assets(get_template(template_id))
    except GeneratorError:
        raise
    except Exception:
        raise GeneratorError("ENCODING_FAILED") from None


def extract_animation_frames(
    asset: Path,
    *,
    fps: int,
    frame_count: int,
    speed: float,
    output_dir: Path,
) -> list[Image.Image]:
    output_dir.mkdir(parents=True, exist_ok=True)
    pattern = output_dir / "frame-%05d.png"
    filter_value = f"setpts=PTS/{speed},fps={fps},scale=480:480:flags=lanczos"
    command = [
        imageio_ffmpeg.get_ffmpeg_exe(),
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-c:v",
        "libvpx-vp9",
        "-i",
        str(asset),
        "-vf",
        filter_value,
        "-frames:v",
        str(frame_count),
        "-vsync",
        "0",
        "-start_number",
        "0",
        "-pix_fmt",
        "rgba",
        str(pattern),
    ]
    try:
        subprocess.run(command, check=True, capture_output=True, timeout=120)
        paths = sorted(output_dir.glob("frame-*.png"))
        if not paths:
            raise GeneratorError("ENCODING_FAILED")
        return [Image.open(path).convert("RGBA") for path in paths]
    except GeneratorError:
        raise
    except (OSError, subprocess.SubprocessError):
        raise GeneratorError("ENCODING_FAILED") from None


def _read_subject(subject_png: bytes | Path) -> Image.Image:
    try:
        if isinstance(subject_png, Path):
            with Image.open(subject_png) as image:
                return image.convert("RGBA").copy()
        with Image.open(BytesIO(subject_png)) as image:
            return image.convert("RGBA").copy()
    except (OSError, ValueError):
        raise GeneratorError("ENCODING_FAILED") from None


def _render_frame(
    background: Image.Image,
    subject: Image.Image,
    foreground: Image.Image,
    editor_state: EditorState,
    *,
    size: int,
) -> Image.Image:
    canvas = background.resize((size, size), Image.Resampling.LANCZOS).convert("RGBA")

    alpha_bounds = subject.getchannel("A").getbbox()
    if alpha_bounds is not None:
        subject = subject.crop(alpha_bounds)
    max_edge = max(subject.size)
    fit_scale = (size * 0.55 / max_edge) * editor_state.scale
    subject_size = (
        max(1, round(subject.width * fit_scale)),
        max(1, round(subject.height * fit_scale)),
    )
    subject = subject.resize(subject_size, Image.Resampling.LANCZOS)
    center_x = round(editor_state.x * size / 480)
    center_y = round(editor_state.y * size / 480)
    canvas.alpha_composite(
        subject,
        dest=(center_x - subject.width // 2, center_y - subject.height // 2),
    )

    foreground = foreground.resize((size, size), Image.Resampling.LANCZOS).convert("RGBA")
    canvas.alpha_composite(foreground)
    return canvas


def encode_gif(frames: list[Image.Image], output_path: Path, *, fps: int) -> None:
    frames_dir = output_path.parent / "encode-frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    for index, frame in enumerate(frames):
        frame.save(frames_dir / f"frame-{index:05d}.png", format="PNG")

    frame_pattern = frames_dir / "frame-%05d.png"
    palette_filter = (
        "split[s0][s1];[s0]palettegen=max_colors=128:reserve_transparent=1[p];"
        "[s1][p]paletteuse=dither=bayer:bayer_scale=3"
    )
    command = [
        imageio_ffmpeg.get_ffmpeg_exe(),
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-framerate",
        str(fps),
        "-i",
        str(frame_pattern),
        "-filter_complex",
        palette_filter,
        "-loop",
        "0",
        str(output_path),
    ]
    try:
        subprocess.run(command, check=True, capture_output=True, timeout=120)
    except (OSError, subprocess.SubprocessError):
        raise GeneratorError("ENCODING_FAILED") from None


def compose(
    *,
    subject_png: bytes | Path,
    template_id: str,
    editor_state: EditorState,
    output_dir: Path,
) -> ComposeResult:
    try:
        manifest = get_template(template_id)
        background_path, animation_path = _template_assets(manifest)
        background_color = get_background_color(editor_state.backgroundId)
        if background_color is None:
            with Image.open(background_path) as image:
                background = image.convert("RGBA").copy()
        else:
            rgb = tuple(int(background_color[index : index + 2], 16) for index in (1, 3, 5))
            background = Image.new("RGBA", (480, 480), (*rgb, 255))
        subject = _read_subject(subject_png)
    except GeneratorError:
        raise
    except Exception:
        raise GeneratorError("ENCODING_FAILED") from None

    output_dir.mkdir(parents=True, exist_ok=True)
    speed = SPEED_MULTIPLIERS[editor_state.speed]
    base_fps = min(15, manifest.fps)
    fallback_fps = min(12, manifest.fps)
    attempts = list(dict.fromkeys([(480, base_fps), (480, fallback_fps), (420, fallback_fps)]))
    cover_path = output_dir / "cover.jpg"

    for size, fps in attempts:
        frame_count = max(1, math.ceil(manifest.durationMs * fps / 1000))
        attempt_dir = output_dir / f"{size}px-{fps}fps"
        animation_frames = extract_animation_frames(
            animation_path,
            fps=fps,
            frame_count=frame_count,
            speed=speed,
            output_dir=attempt_dir / "animation-frames",
        )
        rendered_frames = [
            _render_frame(
                background,
                subject,
                animation_frames[index % len(animation_frames)],
                editor_state,
                size=size,
            )
            for index in range(frame_count)
        ]
        if not cover_path.exists():
            cover_frame = rendered_frames[0]
            if size != 480:
                cover_frame = cover_frame.resize((480, 480), Image.Resampling.LANCZOS)
            cover_frame.convert("RGB").save(cover_path, format="JPEG", quality=88, optimize=True)

        gif_path = attempt_dir / "result.gif"
        attempt_dir.mkdir(parents=True, exist_ok=True)
        encode_gif(rendered_frames, gif_path, fps=fps)
        if gif_path.stat().st_size <= OUTPUT_LIMIT_BYTES:
            return ComposeResult(gif=gif_path, cover=cover_path)
        gif_path.unlink(missing_ok=True)

    raise GeneratorError("ENCODING_FAILED")
