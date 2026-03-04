export class ContractError extends Error {
    public readonly code: string;
    public readonly details?: unknown;

    constructor(code: string, message: string, details?: unknown) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.details = details;
    }
}

export class ContractValidationError extends ContractError {
    constructor(message: string, details?: unknown) {
        super('contract_validation_error', message, details);
    }
}

export class ToolValidationError extends ContractError {
    constructor(message: string, details?: unknown) {
        super('tool_validation_error', message, details);
    }
}

export class ToolNotFoundError extends ContractError {
    constructor(toolName: string, details?: unknown) {
        super('tool_not_found', `Tool not found: ${toolName}`, details);
    }
}

export class ScopeDeniedError extends ContractError {
    constructor(permission: string, details?: unknown) {
        super('scope_denied', `Missing required permission: ${permission}`, details);
    }
}

export class RuntimeTransportError extends ContractError {
    public readonly statusCode?: number;

    constructor(message: string, statusCode?: number, details?: unknown) {
        super('runtime_transport_error', message, details);
        this.statusCode = statusCode;
    }
}
