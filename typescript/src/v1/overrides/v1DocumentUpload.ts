// @manual-override — this file is never overwritten by generate-v1-sdk.mjs
// Typed upload helpers for document ingestion.
// The generated stubs in modules/v1Document.ts accept raw FormData;
// use uploadFile() / uploadFileToFolder() for a friendlier typed interface.

import { DeveloperApiClient } from '../client';

export interface UploadedDocument {
    /** Whether the upload succeeded */
    success: boolean;
    /** Parsed document metadata returned by the server */
    document?: {
        id: string;
        name: string;
        location: string;
        url: string | null;
        title: string | null;
        docAuthor: string | null;
        description: string | null;
        docSource: string | null;
        chunkSource: string | null;
        published: string | null;
        wordCount: number;
        token_count_estimate: number;
        createdAt: string;
        pinnedWorkspaces: string[];
        canWatch: boolean;
    };
    /** Server-level error message when success is false */
    error?: string | null;
}

export interface UploadFileOptions {
    /**
     * Override the filename sent in the multipart form.
     * Defaults to the `name` property of the `File` / `Blob`.
     */
    filename?: string;
}

/**
 * Upload a `File` or `Blob` to the root documents directory.
 *
 * @example
 * ```ts
 * const sdk = new RealtimeXSDK({ realtimex: { apiKey: 'sk-...' } });
 * const result = await uploadFile(sdk.v1!._client, myFile);
 * console.log(result.document?.location);
 * ```
 */
export async function uploadFile(
    client: DeveloperApiClient,
    file: File | Blob,
    options: UploadFileOptions = {},
): Promise<UploadedDocument> {
    const form = new FormData();
    const filename = options.filename ?? (file instanceof File ? file.name : 'upload');
    form.append('file', file, filename);
    return client.requestMultipart<UploadedDocument>('POST', `/v1/document/upload`, form);
}

/**
 * Upload a `File` or `Blob` to a specific folder (created automatically if absent).
 *
 * @example
 * ```ts
 * const sdk = new RealtimeXSDK({ realtimex: { apiKey: 'sk-...' } });
 * const result = await uploadFileToFolder(sdk.v1!._client, myFile, 'contracts');
 * ```
 */
export async function uploadFileToFolder(
    client: DeveloperApiClient,
    file: File | Blob,
    folderName: string,
    options: UploadFileOptions = {},
): Promise<UploadedDocument> {
    const form = new FormData();
    const filename = options.filename ?? (file instanceof File ? file.name : 'upload');
    form.append('file', file, filename);
    return client.requestMultipart<UploadedDocument>(
        'POST',
        `/v1/document/upload/${encodeURIComponent(folderName)}`,
        form,
    );
}
