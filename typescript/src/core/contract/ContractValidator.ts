import {
    ContractCapability,
    ContractCallbackRules,
    ContractStrictness,
    LocalAppContractV1,
} from '../types/contract';
import { ContractValidationError } from '../errors/ContractErrors';

const LOCAL_APP_CONTRACT_VERSION = 'local-app-contract/v1';

const DEFAULT_SUPPORTED_EVENTS = [
    'task.trigger',
    'system.ping',
    'task.claimed',
    'task.started',
    'task.progress',
    'task.completed',
    'task.failed',
    'task.canceled',
];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
    if (!isRecord(value)) return undefined;

    const entries = Object.entries(value).filter(
        ([key, item]) => key.trim().length > 0 && typeof item === 'string'
    );

    if (entries.length === 0) return undefined;

    return entries.reduce<Record<string, string>>((accumulator, [key, item]) => {
        accumulator[key] = item as string;
        return accumulator;
    }, {});
}

function normalizeStrictness(value: unknown): ContractStrictness {
    return value === 'strict' ? 'strict' : 'compatible';
}

function normalizeCallbackRules(value: unknown): ContractCallbackRules | undefined {
    if (!isRecord(value)) return undefined;

    const callback: ContractCallbackRules = {};

    if (typeof value.event_id_header === 'string') callback.event_id_header = value.event_id_header;
    if (typeof value.signature_header === 'string') callback.signature_header = value.signature_header;
    if (typeof value.signature_algorithm === 'string') callback.signature_algorithm = value.signature_algorithm;
    if (typeof value.signature_message === 'string') callback.signature_message = value.signature_message;
    if (typeof value.attempt_id_format === 'string') callback.attempt_id_format = value.attempt_id_format;
    if (typeof value.idempotency === 'string') callback.idempotency = value.idempotency;

    return Object.keys(callback).length > 0 ? callback : undefined;
}

function normalizeTrigger(value: unknown): ContractCapability['trigger'] {
    if (!isRecord(value)) {
        return { event: 'task.trigger' };
    }

    const event = value.event === 'task.trigger' ? 'task.trigger' : 'task.trigger';
    const route = typeof value.route === 'string' && value.route.trim().length > 0 ? value.route : undefined;
    const payloadTemplate = isRecord(value.payload_template) ? value.payload_template : undefined;

    return {
        event,
        route,
        payload_template: payloadTemplate,
    };
}

function normalizeCapabilityConfigEntries(
    value: unknown
): Array<{ key: string; description?: string; source?: string; sensitive?: boolean }> {
    if (!Array.isArray(value)) return [];
    const output: Array<{
        key: string;
        description?: string;
        source?: string;
        sensitive?: boolean;
    }> = [];
    const seen = new Set<string>();

    for (const entry of value) {
        if (typeof entry === 'string' && entry.trim()) {
            const key = entry.trim();
            const dedupeKey = key.toLowerCase();
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            output.push({ key });
            continue;
        }
        if (!isRecord(entry)) continue;
        const keyCandidate = [entry.key, entry.name, entry.id, entry.field].find(
            (candidate) => typeof candidate === 'string' && candidate.trim().length > 0
        );
        if (typeof keyCandidate !== 'string' || !keyCandidate.trim()) continue;
        const key = keyCandidate.trim();
        const dedupeKey = key.toLowerCase();
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const normalizedEntry: {
            key: string;
            description?: string;
            source?: string;
            sensitive?: boolean;
        } = { key };
        if (typeof entry.description === 'string' && entry.description.trim().length > 0) {
            normalizedEntry.description = entry.description.trim();
        }
        if (typeof entry.source === 'string' && entry.source.trim().length > 0) {
            normalizedEntry.source = entry.source.trim();
        }
        if (entry.sensitive === true) {
            normalizedEntry.sensitive = true;
        }
        output.push(normalizedEntry);
    }

    return output;
}

function normalizeCapabilityConfiguration(
    value: unknown
): ContractCapability['configuration'] {
    if (!isRecord(value)) return null;
    const required = normalizeCapabilityConfigEntries(
        value.required ?? value.required_fields ?? value.requiredFields
    );
    const optional = normalizeCapabilityConfigEntries(
        value.optional ?? value.optional_fields ?? value.optionalFields
    );
    const setupSteps = asStringArray(value.setup_steps ?? value.setupSteps ?? value.steps);
    const notes = asStringArray(value.notes);
    const hasValues =
        required.length > 0 ||
        optional.length > 0 ||
        setupSteps.length > 0 ||
        notes.length > 0;
    if (!hasValues) return null;
    return {
        required,
        optional,
        setup_steps: setupSteps,
        notes,
    };
}

function normalizeCapability(value: unknown): ContractCapability {
    if (!isRecord(value)) {
        throw new ContractValidationError('Invalid capability: expected object');
    }

    const capabilityId = typeof value.capability_id === 'string' ? value.capability_id.trim() : '';
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    const description = typeof value.description === 'string' ? value.description.trim() : '';
    const permission = typeof value.permission === 'string' ? value.permission.trim() : '';

    if (!capabilityId || !name || !description || !permission) {
        throw new ContractValidationError('Invalid capability: missing required fields', { capability: value });
    }

    if (!isRecord(value.input_schema)) {
        throw new ContractValidationError('Invalid capability input_schema: expected JSON schema object', {
            capability_id: capabilityId,
        });
    }

    return {
        capability_id: capabilityId,
        name,
        description,
        input_schema: value.input_schema,
        output_schema: isRecord(value.output_schema) ? value.output_schema : undefined,
        permission,
        trigger: normalizeTrigger(value.trigger),
        configuration: normalizeCapabilityConfiguration(
            isRecord(value.configuration)
                ? value.configuration
                : isRecord(value.config_requirements)
                ? value.config_requirements
                : isRecord(value.configRequirements)
                ? value.configRequirements
                : undefined
        ),
    };
}

function normalizeCapabilities(value: unknown): ContractCapability[] | undefined {
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value)) {
        throw new ContractValidationError('Invalid capabilities: expected array');
    }

    return value.map(normalizeCapability);
}

function extractContractRecord(payload: unknown): Record<string, unknown> {
    if (!isRecord(payload)) {
        throw new ContractValidationError('Invalid contract response: expected object payload');
    }

    if (isRecord(payload.contract)) {
        return payload.contract;
    }

    return payload;
}

function resolveContractVersion(contract: Record<string, unknown>): string {
    if (typeof contract.contract_version === 'string') return contract.contract_version;
    if (typeof contract.version === 'string') return contract.version;
    if (typeof contract.id === 'string') return contract.id;
    return '';
}

export function normalizeLocalAppContractV1(payload: unknown): LocalAppContractV1 {
    const contract = extractContractRecord(payload);
    const version = resolveContractVersion(contract);

    if (!version) {
        throw new ContractValidationError('Missing contract version in discovery response');
    }

    if (version !== LOCAL_APP_CONTRACT_VERSION) {
        throw new ContractValidationError('Unsupported contract version', {
            expected: LOCAL_APP_CONTRACT_VERSION,
            received: version,
        });
    }

    const supportedContractEvents =
        asStringArray(contract.supported_contract_events).length > 0
            ? asStringArray(contract.supported_contract_events)
            : asStringArray(contract.supported_events).length > 0
            ? asStringArray(contract.supported_events)
            : DEFAULT_SUPPORTED_EVENTS;

    return {
        contract_version: LOCAL_APP_CONTRACT_VERSION,
        strictness: normalizeStrictness(contract.strictness),
        supported_contract_events: supportedContractEvents,
        supported_legacy_events: asStringArray(contract.supported_legacy_events),
        aliases: asStringRecord(contract.aliases),
        status_map: asStringRecord(contract.status_map),
        legacy_action_map: asStringRecord(contract.legacy_action_map),
        callback: normalizeCallbackRules(contract.callback),
        capabilities: normalizeCapabilities(contract.capabilities),
    };
}
