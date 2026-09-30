from io import BytesIO

import pytest
from PIL import Image

from app.errors import GeneratorError
from app.image_validation import validate_image
from app.matting import RembgMattingProvider


def image_bytes(size=(640, 480), fmt="PNG", exif=None):
    image = Image.new("RGB", size, (120, 80, 40))
    output = BytesIO()
    image.save(output, format=fmt, exif=exif or b"")
    return output.getvalue()


def test_rejects_image_with_short_edge_below_320():
    with pytest.raises(GeneratorError, match="IMAGE_TOO_SMALL"):
        validate_image(image_bytes((319, 640)), "image/png")


def test_rejects_mime_that_does_not_match_decoded_image():
    with pytest.raises(GeneratorError, match="INVALID_IMAGE"):
        validate_image(image_bytes(), "image/jpeg")


def test_applies_exif_orientation_before_returning_pixels():
    exif = Image.Exif()
    exif[274] = 6
    decoded = validate_image(image_bytes((640, 480), "JPEG", exif), "image/jpeg")

    assert decoded.size == (480, 640)
    assert decoded.mode == "RGBA"


def test_rejects_images_over_decoded_pixel_limit(monkeypatch):
    import app.image_validation as image_validation

    monkeypatch.setattr(image_validation, "MAX_PIXELS", 10)
    with pytest.raises(GeneratorError, match="IMAGE_TOO_LARGE"):
        image_validation.validate_image(image_bytes((4, 3)), "image/png")


def test_matting_rejects_subject_smaller_than_five_percent():
    def fake_remove(image, **_kwargs):
        result = Image.new("RGBA", image.size, (0, 0, 0, 0))
        result.putpixel((0, 0), (255, 0, 0, 255))
        return result

    with pytest.raises(GeneratorError, match="SUBJECT_NOT_FOUND"):
        RembgMattingProvider(remove_fn=fake_remove).extract_subject(
            Image.new("RGBA", (100, 100), (80, 90, 100, 255))
        )


def test_matting_runtime_errors_are_stable():
    def broken_remove(_image, **_kwargs):
        raise RuntimeError("model runtime unavailable")

    with pytest.raises(GeneratorError, match="MATTING_FAILED"):
        RembgMattingProvider(remove_fn=broken_remove).extract_subject(
            Image.new("RGBA", (100, 100), (80, 90, 100, 255))
        )
