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

export interface ContractCapability {
    capability_id: string;
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
    output_schema?: Record<string, unknown>;
    permission: string;
    trigger: ContractCapabilityTrigger;
    execution_mode?: 'delegate_only' | 'assist_then_delegate' | 'agent_only';
    approval_required?: boolean;
    approval_policy?: Record<string, unknown>;
    allowed_preprocessing?: string[];
    allowed_side_effects?: string[];
    network_policy?: Record<string, unknown>;
    artifact_policy?: Record<string, unknown>;
    tags?: string[];
    examples?: string[];
    risk_level?: 'low' | 'medium' | 'high' | null;
    enabled?: boolean;
    metadata?: Record<string, unknown>;
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
