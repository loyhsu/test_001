class GeneratorError(Exception):
    """An expected generation failure safe to expose to the trusted caller."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code
