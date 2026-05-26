class AiqaError(Exception):
    """Raised when the AIQA server returns an error response."""
    def __init__(self, message: str, status_code: int = 0) -> None:
        super().__init__(message)
        self.status_code = status_code


class AiqaTimeoutError(AiqaError):
    """Raised when waiting for a run to complete exceeds the timeout."""
