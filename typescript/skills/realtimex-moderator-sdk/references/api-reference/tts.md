# sdk.tts — Text-to-Speech

> Auto-generated from `@realtimex/sdk` source · v**1.7.19** · 2026-05-18

## `TTSModule`

### Methods

```ts
// Request a single permission from Electron via internal API
async speak(text: string, options: TTSOptions = {}): Promise<ArrayBuffer>

// Generate speech from text with streaming (yields decoded audio chunks)
async *speakStream(text: string, options: TTSOptions = {}): AsyncGenerator<TTSChunk>

// List available TTS providers with configuration options
async listProviders(): Promise<TTSProvider[]>
```
