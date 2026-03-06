import { describe, expect, it } from 'vitest';
import { normalizeLocalAppContractV1 } from './ContractValidator';

describe('ContractValidator', () => {
    it('preserves explicit null risk_level values', () => {
        const normalized = normalizeLocalAppContractV1({
            contract: {
                contract_version: 'local-app-contract/v1',
                capabilities: [
                    {
                        capability_id: 'folio.documents.add',
                        name: 'Add Document',
                        description: 'Queue a document for ingestion.',
                        permission: 'webhook.trigger',
                        input_schema: {
                            type: 'object',
                            required: ['file_path'],
                            properties: {
                                file_path: { type: 'string' },
                            },
                        },
                        risk_level: null,
                    },
                ],
            },
        });

        expect(normalized.capabilities?.[0]?.risk_level).toBeNull();
    });
});
