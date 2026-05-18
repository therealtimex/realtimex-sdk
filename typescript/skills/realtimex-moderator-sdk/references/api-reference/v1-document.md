# sdk.v1.document — v1 Document

> Auto-generated from `@realtimex/sdk` source · v**1.7.18** · 2026-05-18

## `V1DocumentModule`

### Methods

```ts
// Upload a new file to RealTimeX to be parsed and prepared for embedding.
async uploadLink(body?: Record<string, unknown>): Promise<unknown>

// Upload a file by specifying its raw text content and metadata values without having to upload a file.
async rawText(body?: Record<string, unknown>): Promise<unknown>

// List of all locally-stored documents in instance
async listDocuments(): Promise<unknown>

// Get all documents stored in a specific folder.
async getFolder(folderName: string): Promise<unknown>

// Check available filetypes and MIMEs that can be uploaded.
async listAcceptedFileTypes(): Promise<unknown>

// Get the known available metadata schema for when doing a raw-text upload and the acceptable type of value for each key.
async getMetadataSchema(): Promise<unknown>

// Get a single document by its unique RealTimeX document name
async getDocument(docName: string): Promise<unknown>

// Create a new folder inside the documents storage directory.
async createFolder(body?: Record<string, unknown>): Promise<unknown>

// Remove a folder and all its contents from the documents storage directory.
async deleteRemoveFolder(): Promise<unknown>

// Move files within the documents storage directory.
async moveFiles(body?: Record<string, unknown>): Promise<unknown>
```
