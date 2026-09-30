from io import BytesIO
import os
from typing import Callable

from PIL import Image

from .errors import GeneratorError

DEFAULT_MODEL = "u2net"


class RembgMattingProvider:
    def __init__(
        self,
        model_name: str | None = None,
        remove_fn: Callable | None = None,
        session_factory: Callable | None = None,
    ):
        self.model_name = model_name or os.getenv("GENERATOR_MATTING_MODEL", DEFAULT_MODEL)
        self.remove_fn = remove_fn
        self.session_factory = session_factory
        self._session = None

    def _load_runtime(self):
        if self.remove_fn is None:
            from rembg import new_session, remove

            self.remove_fn = remove
            self.session_factory = self.session_factory or new_session

    def extract_subject(self, image: Image.Image) -> bytes:
        try:
            self._load_runtime()
            if self._session is None and self.session_factory is not None:
                self._session = self.session_factory(model_name=self.model_name)
            kwargs = {"session": self._session} if self._session is not None else {}
            result = self.remove_fn(image, **kwargs)
            if isinstance(result, Image.Image):
                subject = result.convert("RGBA")
            else:
                subject = Image.open(BytesIO(result)).convert("RGBA")

            alpha = subject.getchannel("A")
            bounds = alpha.getbbox()
            if bounds is None:
                raise GeneratorError("SUBJECT_NOT_FOUND")
            left, top, right, bottom = bounds
            if (right - left) * (bottom - top) < subject.width * subject.height * 0.05:
                raise GeneratorError("SUBJECT_NOT_FOUND")

            output = BytesIO()
            subject.save(output, format="PNG")
            return output.getvalue()
        except GeneratorError:
            raise
        except Exception:
            raise GeneratorError("MATTING_FAILED") from None
