from io import BytesIO
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError

from .errors import GeneratorError

MIN_SHORT_EDGE = 320
MAX_PIXELS = 25_000_000
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MIME_FORMATS = {
    "image/png": "PNG",
    "image/jpeg": "JPEG",
    "image/jpg": "JPEG",
}


def validate_image(payload: bytes, content_type: str | None) -> Image.Image:
    mime_type = (content_type or "").split(";", 1)[0].strip().lower()
    expected_format = MIME_FORMATS.get(mime_type)
    if expected_format is None or not payload:
        raise GeneratorError("INVALID_IMAGE")
    if len(payload) > MAX_UPLOAD_BYTES:
        raise GeneratorError("IMAGE_TOO_LARGE")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(payload)) as decoded:
                if decoded.format != expected_format:
                    raise GeneratorError("INVALID_IMAGE")
                width, height = decoded.size
                if width * height > MAX_PIXELS:
                    raise GeneratorError("IMAGE_TOO_LARGE")
                if min(width, height) < MIN_SHORT_EDGE:
                    raise GeneratorError("IMAGE_TOO_SMALL")
                decoded.load()
                return ImageOps.exif_transpose(decoded).convert("RGBA").copy()
    except GeneratorError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise GeneratorError("IMAGE_TOO_LARGE") from None
    except (UnidentifiedImageError, OSError, ValueError):
        raise GeneratorError("INVALID_IMAGE") from None
