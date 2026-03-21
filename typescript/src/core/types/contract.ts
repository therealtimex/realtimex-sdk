export type ProviderKind = 'gemini' | 'claude' | 'codex';

export type ContractStrictness = 'compatible' | 'strict';

export interface ContractCallbackRules {
    event_id_header?: string;
    signature_header?: string;
    signature_algorithm?: string;
    signature_message?: string;
    attempt_id_format?: string;
    idempotency?: string;
}

export interface ContractCapabilityTrigger {
    event: 'task.trigger';
    route?: string;
    payload_template?: Record<string, unknown>;
}

export interface ContractCapabilityConfigEntry {
    key: string;
    description?: string;
    source?: string;
    sensitive?: boolean;
}

export interface ContractCapabilityConfiguration {
    required?: Array<ContractCapabilityConfigEntry | string>;
    optional?: Array<ContractCapabilityConfigEntry | string>;
    setup_steps?: string[];
    notes?: string[];
}

export interface ContractCapability {
    capability_id: string;
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
    output_schema?: Record<string, unknown>;
    permission: string;
    trigger: ContractCapabilityTrigger;
    configuration?: ContractCapabilityConfiguration | null;
}

export interface LocalAppContractV1 {
    contract_version: 'local-app-contract/v1';
    strictness: ContractStrictness;
    supported_contract_events: string[];
    supported_legacy_events?: string[];
    aliases?: Record<string, string>;
    status_map?: Record<string, string>;
    legacy_action_map?: Record<string, string>;
    callback?: ContractCallbackRules;
    capabilities?: ContractCapability[];
}

export interface LegacyLocalAppContractShape {
    id?: string;
    version?: string;
    strictness?: ContractStrictness;
    supported_events?: string[];
    supported_contract_events?: string[];
    supported_legacy_events?: string[];
    aliases?: Record<string, string>;
    status_map?: Record<string, string>;
    legacy_action_map?: Record<string, string>;
    callback?: ContractCallbackRules;
    capabilities?: ContractCapability[];
}

export interface ContractDiscoveryResponse {
    success: boolean;
    contract: LocalAppContractV1 | LegacyLocalAppContractShape;
}
