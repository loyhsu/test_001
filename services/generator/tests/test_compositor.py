from io import BytesIO
import subprocess

import imageio_ffmpeg
import pytest
from PIL import Image

from app.compositor import ComposeResult, _render_frame, compose, extract_animation_frames
from app.errors import GeneratorError
from app.models import EditorState
from app.template_catalog import Manifest


def png_bytes(image):
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def setup_template(tmp_path, monkeypatch):
    import app.compositor as compositor

    template_dir = tmp_path / "templates" / "test-template"
    template_dir.mkdir(parents=True)
    Image.new("RGBA", (480, 480), (255, 0, 0, 255)).save(template_dir / "background.png")
    Image.new("RGBA", (480, 480), (0, 0, 255, 128)).save(template_dir / "foreground.png")

    manifest = Manifest.model_validate(
        {
            "id": "test-template",
            "name": "Test",
            "category": "emotion",
            "durationMs": 1200,
            "fps": 15,
            "canvas": {"width": 480, "height": 480},
            "subject": {
                "defaultX": 240,
                "defaultY": 240,
                "defaultScale": 1,
                "minScale": 0.65,
                "maxScale": 1.6,
            },
            "layers": [
                {"type": "background", "asset": "background.png"},
                {"type": "subject"},
                {"type": "animation", "asset": "foreground.png"},
            ],
        }
    )
    monkeypatch.setattr(compositor, "get_template", lambda _template_id: manifest)
    monkeypatch.setattr(compositor, "TEMPLATE_ROOT", tmp_path / "templates")
    monkeypatch.setattr(
        compositor,
        "extract_animation_frames",
        lambda *_args, **_kwargs: [Image.new("RGBA", (480, 480), (0, 0, 255, 128))],
    )
    return manifest


def test_compositor_outputs_bounded_gif_cover_and_keeps_manifest_layer_order(
    tmp_path, monkeypatch
):
    setup_template(tmp_path, monkeypatch)
    subject = Image.new("RGBA", (160, 160), (0, 255, 0, 255))
    output_dir = tmp_path / "output"
    output_dir.mkdir()

    result = compose(
        subject_png=png_bytes(subject),
        template_id="test-template",
        editor_state=EditorState(x=240, y=240, scale=1, speed="standard"),
        output_dir=output_dir,
    )

    assert result.gif.stat().st_size <= 8_388_608
    assert Image.open(result.cover).size == (480, 480)
    pixel = Image.open(result.cover).convert("RGB").getpixel((240, 240))
    assert pixel[2] > pixel[1] > pixel[0]


def test_editor_position_and_scale_transform_the_subject():
    background = Image.new("RGBA", (480, 480), (255, 0, 0, 255))
    subject = Image.new("RGBA", (160, 160), (0, 255, 0, 255))
    foreground = Image.new("RGBA", (480, 480), (0, 0, 0, 0))

    centered = _render_frame(
        background,
        subject,
        foreground,
        EditorState(x=240, y=240, scale=1, speed="standard"),
        size=480,
    )
    centered_small = _render_frame(
        background,
        subject,
        foreground,
        EditorState(x=240, y=240, scale=0.65, speed="standard"),
        size=480,
    )
    moved = _render_frame(
        background,
        subject,
        foreground,
        EditorState(x=80, y=80, scale=1, speed="standard"),
        size=480,
    )

    assert centered.getpixel((120, 240))[1] == 255
    assert centered_small.getpixel((120, 240))[0] == 255
    assert moved.getpixel((80, 80))[1] == 255
    assert moved.getpixel((240, 240))[0] == 255


@pytest.mark.parametrize(
    ("background_id", "expected_pixel"),
    [
        ("sky-blue", (220, 238, 255, 255)),
        ("template", (255, 0, 0, 255)),
    ],
)
def test_preset_background_replaces_manifest_background(
    tmp_path, monkeypatch, background_id, expected_pixel
):
    import app.compositor as compositor

    setup_template(tmp_path, monkeypatch)
    monkeypatch.setattr(
        compositor,
        "extract_animation_frames",
        lambda *_args, **_kwargs: [Image.new("RGBA", (480, 480), (0, 0, 0, 0))],
    )
    rendered = []

    def capture_frames(frames, output_path, *, fps):
        rendered.extend(frame.copy() for frame in frames)
        output_path.write_bytes(b"gif")

    monkeypatch.setattr(compositor, "encode_gif", capture_frames)
    output_dir = tmp_path / f"output-{background_id}"

    compositor.compose(
        subject_png=png_bytes(Image.new("RGBA", (160, 160), (0, 255, 0, 255))),
        template_id="test-template",
        editor_state=EditorState(
            x=240,
            y=240,
            scale=1,
            speed="standard",
            backgroundId=background_id,
        ),
        output_dir=output_dir,
    )

    assert rendered[0].getpixel((0, 0)) == expected_pixel


def test_retries_oversized_gif_at_lower_fps_then_smaller_canvas(tmp_path, monkeypatch):
    import app.compositor as compositor

    setup_template(tmp_path, monkeypatch)
    output_dir = tmp_path / "output"
    output_dir.mkdir()
    calls = []

    def fake_encode(_frames, output_path, *, fps):
        calls.append((output_path, fps))
        output_path.write_bytes(b"x" * (8_388_609 if len(calls) < 3 else 100))

    monkeypatch.setattr(compositor, "encode_gif", fake_encode)
    result = compositor.compose(
        subject_png=png_bytes(Image.new("RGBA", (160, 160), (0, 255, 0, 255))),
        template_id="test-template",
        editor_state=EditorState(x=240, y=240, scale=1, speed="standard"),
        output_dir=output_dir,
    )

    assert [(path.parent.name, fps) for path, fps in calls] == [
        ("480px-15fps", 15),
        ("480px-12fps", 12),
        ("420px-12fps", 12),
    ]
    assert result.gif.stat().st_size == 100


def test_returns_encoding_failed_when_all_size_fallbacks_exceed_limit(tmp_path, monkeypatch):
    import app.compositor as compositor

    setup_template(tmp_path, monkeypatch)
    output_dir = tmp_path / "output"
    output_dir.mkdir()

    def always_oversized(_frames, output_path, *, fps):
        output_path.write_bytes(b"x" * 8_388_609)

    monkeypatch.setattr(compositor, "encode_gif", always_oversized)
    with pytest.raises(GeneratorError, match="ENCODING_FAILED"):
        compositor.compose(
            subject_png=png_bytes(Image.new("RGBA", (160, 160), (0, 255, 0, 255))),
            template_id="test-template",
            editor_state=EditorState(x=240, y=240, scale=1, speed="standard"),
            output_dir=output_dir,
        )


def test_extracts_animation_frames_from_webm(tmp_path):
    source_dir = tmp_path / "source-frames"
    source_dir.mkdir()
    Image.new("RGBA", (480, 480), (0, 0, 0, 0)).save(source_dir / "frame-00.png")
    Image.new("RGBA", (480, 480), (255, 40, 20, 255)).save(source_dir / "frame-01.png")
    animation = tmp_path / "foreground.webm"
    subprocess.run(
        [
            imageio_ffmpeg.get_ffmpeg_exe(),
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-framerate",
            "2",
            "-i",
            str(source_dir / "frame-%02d.png"),
            "-c:v",
            "libvpx-vp9",
            "-pix_fmt",
            "yuva420p",
            "-auto-alt-ref",
            "0",
            str(animation),
        ],
        check=True,
        capture_output=True,
        timeout=30,
    )

    frames = extract_animation_frames(
        animation,
        fps=2,
        frame_count=2,
        speed=1.0,
        output_dir=tmp_path / "decoded",
    )

    assert len(frames) == 2
    assert all(frame.size == (480, 480) for frame in frames)
    assert frames[0].getchannel("A").getextrema() == (0, 0)
    assert frames[1].getchannel("A").getextrema() == (255, 255)
