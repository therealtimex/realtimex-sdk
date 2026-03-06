import { describe, expect, it } from 'vitest';
import { toStableToolName } from './ToolNamePolicy';

describe('toStableToolName', () => {
    it('returns namespace_tool for empty capability IDs', () => {
        expect(toStableToolName('   ', 'Folio App')).toBe('folio_app_tool');
    });

    it('deduplicates namespace prefix when capability already starts with namespace', () => {
        expect(toStableToolName('folio.documents.add', 'folio')).toBe('folio_documents_add');
    });

    it('prefixes numeric-start names with tool_', () => {
        expect(toStableToolName('123.export')).toBe('tool_123_export');
    });

    it('normalizes dot-separated capability IDs and applies namespace prefix', () => {
        expect(toStableToolName('acme.invoice.create', 'rtx')).toBe(
            'rtx_acme_invoice_create'
        );
    });
});
