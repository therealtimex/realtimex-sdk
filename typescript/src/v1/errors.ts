/**
 * RealtimeX SDK - Developer API (v1) Error Classes
 */

export class DeveloperApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: string,
        message: string
    ) {
        super(message);
        this.name = 'DeveloperApiError';
    }
}

export class AuthenticationError extends DeveloperApiError {
    constructor(message = 'Invalid or missing API key') {
        super(403, 'AUTHENTICATION_ERROR', message);
        this.name = 'AuthenticationError';
    }
}

export class NotFoundError extends DeveloperApiError {
    constructor(message = 'Resource not found') {
        super(404, 'NOT_FOUND', message);
        this.name = 'NotFoundError';
    }
}

export class ValidationError extends DeveloperApiError {
    constructor(message: string) {
        super(400, 'VALIDATION_ERROR', message);
        this.name = 'ValidationError';
    }
}

export class ServerError extends DeveloperApiError {
    constructor(message = 'Internal server error') {
        super(500, 'SERVER_ERROR', message);
        this.name = 'ServerError';
    }
}
