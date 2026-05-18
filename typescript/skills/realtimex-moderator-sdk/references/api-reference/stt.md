# sdk.stt — Speech-to-Text

> Auto-generated from `@realtimex/sdk` source · v**1.7.18** · 2026-05-18

## `STTModule` *(extends ApiModule)*

### Methods

```ts
// Get available STT providers and their models.
async listProviders(): Promise<STTProvider[]>

// Listen to microphone and transcribe speech to text.
async listen(options: STTListenOptions): Promise<STTResponse>
```
