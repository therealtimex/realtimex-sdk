"""
RealtimeX SDK - Developer API (v1) Error Classes
"""


class DeveloperApiError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code


class AuthenticationError(DeveloperApiError):
    def __init__(self, message: str = "Invalid or missing API key") -> None:
        super().__init__(403, "AUTHENTICATION_ERROR", message)


class NotFoundError(DeveloperApiError):
    def __init__(self, message: str = "Resource not found") -> None:
        super().__init__(404, "NOT_FOUND", message)


class ValidationError(DeveloperApiError):
    def __init__(self, message: str) -> None:
        super().__init__(400, "VALIDATION_ERROR", message)


class ServerError(DeveloperApiError):
    def __init__(self, message: str = "Internal server error") -> None:
        super().__init__(500, "SERVER_ERROR", message)
