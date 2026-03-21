# Contract SDK Redesign (2026-03-09)

Status: Proposed
Scope: `@realtimex/sdk` and `realtimex-sdk`

## Summary

The SDK should become the canonical contract runtime for Local Apps.

Today the SDK is split:

- TypeScript already has useful local-runtime primitives:
  - manifest compile/migration
  - local invoke adapter
  - runtime/tooling abstractions
- Python is still primarily a client for Main App endpoints.

The target design is:

- Host owns platform concerns:
  - discovery/indexing
  - workspace/session context brokering
  - telemetry aggregation
  - approval UX/audit
  - optional `contracts.*` accelerator tools
- SDK owns contract concerns:
  - capability normalization
  - skill publishing
  - preflight/invoke/health router
  - policy enforcement
  - normalized errors
  - language-level developer ergonomics

This keeps the host reusable across engines and makes Local App onboarding SDK-first.

## Design Principles

1. Manifest-first: app developers declare capabilities, not host payloads.
2. Handler-first: app developers write business handlers, not protocol glue.
3. Host-agnostic execution: the same capability should work whether invoked by direct skill execution or host `contracts.*` wrappers.
4. Shared policy: execution policy lives in SDK once, not in each app.
5. Language parity: Python and TypeScript should expose the same contract surface.

## Best DX

The ideal Local App flow is:

1. Define app metadata once.
2. Declare capabilities in code.
3. Implement plain handlers.
4. Mount one router.
5. Publish skills automatically.

Target TypeScript shape:

```ts
import { defineLocalApp, z } from "@realtimex/sdk/contracts";

const app = defineLocalApp({
  appId: "folio",
  appName: "Folio",
  capabilities: [
    {
      capability_id: "documents.add",
      name: "Add Document",
      description: "Queue a document for ingestion.",
      input_schema: z.object({
        file_path: z.string(),
      }),
      execution_mode: "assist_then_delegate",
      preflight: {
        required_preprocessing: ["check_pdf_text_coverage", "ocr_pdf"],
      },
    },
  ],
  handlers: {
    "documents.add": async ({ args, context }) => {
      return {
        task_id: await enqueueDocument(String(args.file_path), context),
        status: "queued",
        message: "Queued",
      };
    },
  },
});

app.mount(expressApp);
await app.publishSkills();
```

Target Python shape:

```python
from realtimex_sdk.contract import define_local_app

app = define_local_app(
    app_id="folio",
    app_name="Folio",
    capabilities=[
        {
            "capability_id": "documents.add",
            "name": "Add Document",
            "input_schema": {
                "type": "object",
                "properties": {"file_path": {"type": "string"}},
                "required": ["file_path"],
            },
            "execution_mode": "assist_then_delegate",
        }
    ],
    handlers={
        "documents.add": add_document_handler,
    },
)

app.mount_fastapi(fastapi_app)
app.publish_skills()
```

What developers should not have to do:

- handwrite `SKILL.md`
- manually shape webhook payloads
- implement `preflight` policy by hand
- understand Main App `contracts.*` semantics
- build different patterns in TS and Python

## Required Public SDK Surface

### 1. Capability compile

Keep and expand:

- `compileCapabilities()`
- `setLocalCapabilityManifest()`
- `getCompiledCapabilities()`
- `getCapabilityCompileReport()`

Responsibilities:

- normalize aliases
- validate capability shape
- normalize execution mode
- normalize delivery and configuration
- normalize error codes
- support schema adapters later (Zod, Pydantic, OpenAPI fragments)

### 2. Skill publishing

Add:

- `publishSkills()`
- `buildSkillArtifacts()`

Responsibilities:

- write `skill.json`
- write `SKILL.md`
- write per-app and root `index.json`
- guarantee no embedded secrets
- include direct app API invoke/preflight instructions

### 3. Contract router

Add:

- `createContractRouter()`
- `handlePreflightRequest()`
- `handleInvokeRequest()`
- `createPreflightHandler()`
- `createInvokeHandler()`
- `createHealthHandler()`

Mounted routes:

- `POST /api/contracts/preflight`
- `POST /api/contracts/invoke`
- `GET /api/contracts/health`

### 4. Policy runtime

Add shared enforcement for:

- required args
- `execution_mode`
- preprocessing requirements
- approval requirements
- network/artifact policies
- idempotency
- normalized error codes

### 5. Context adapters

Add:

- `contextProvider(req)`
- `authProvider(req)`
- optional `approvalProvider(req, capability, args)`
- telemetry sink hooks

The host should still broker trusted session context. The SDK should consume that via adapters, not invent its own trust model.

## File-by-File Design

### TypeScript

#### `typescript/src/modules/contract.ts`

Keep as the public high-level module, but narrow its responsibility to orchestration and compatibility wrappers.

Should contain:

- public contract API facade
- backward-compatible wrappers
- lightweight exports for app developers

Should stop being the only location for all contract logic.

Move internals out to focused modules:

- compile
- router
- publisher
- policy
- context

#### `typescript/src/core/types/contract.ts`

Expand to become the canonical shared types for:

- manifest input
- normalized capability
- preflight request/response
- invoke request/response
- health response
- skill artifact payloads
- publisher outputs
- router options

Add explicit portable types:

- `NormalizedContractErrorCode`
- `ContractExecutionMode`
- `ContractPreflightDecision`
- `PublishSkillsInput`
- `CreateContractRouterOptions`

#### `typescript/src/core/errors/ContractErrors.ts`

Keep existing error classes, but add normalized contract-domain errors:

- `InputInvalidError`
- `AuthExpiredError`
- `ContextMissingError`
- `PreprocessingRequiredError`
- `ApprovalRequiredError`
- `ResourceUnavailableError`
- `ExecutionFailedError`

These should map 1:1 to wire-level error responses.

#### `typescript/src/core/runtime/ContractRuntime.ts`

Keep this for host/provider tool execution paths.

Change boundary:

- it should become a wrapper over SDK-published contract APIs
- it should not become the primary source of policy truth

This module remains useful for:

- ACP adapters
- host-side `contracts.*`
- tool projection for providers

#### `typescript/src/core/contract/ContractClient.ts`

Keep as the HTTP client for discovery and remote execution.

Expand to support:

- `preflight()`
- `invoke()`
- `health()`

This becomes the shared transport client used by:

- host wrappers
- direct skill execution
- tests

#### `typescript/src/core/contract/ContractValidator.ts`

Keep and expand into validation utilities shared by:

- compile
- preflight
- invoke
- publisher

#### `typescript/src/core/tooling/SchemaNormalizer.ts`

Reuse for schema normalization and extend to support developer-native schema inputs.

Short-term:

- JSON Schema objects

Later:

- Zod
- TypeBox
- OpenAPI fragments

#### `typescript/src/core/tooling/ToolProjector.ts`

Keep for provider-facing tool projection only.

Do not let this define capability semantics.

#### `typescript/src/acp/*`

Keep ACP modules as adapters only:

- `ACPContractAdapter.ts`
- `ACPEventMapper.ts`
- `ACPPermissionBridge.ts`
- `ACPTelemetry.ts`

They should consume the normalized contract APIs and runtime events, not duplicate policy.

#### New files to add

Recommended new TS files:

- `typescript/src/core/contract/CapabilityCompiler.ts`
- `typescript/src/core/contract/SkillPublisher.ts`
- `typescript/src/core/contract/SkillTemplate.ts`
- `typescript/src/core/contract/ContractRouter.ts`
- `typescript/src/core/contract/PreflightEngine.ts`
- `typescript/src/core/contract/InvokeEngine.ts`
- `typescript/src/core/contract/PolicyEngine.ts`
- `typescript/src/core/contract/ErrorNormalizer.ts`
- `typescript/src/core/contract/ContextAdapters.ts`
- `typescript/src/core/types/skill.ts`

### Python

#### `python/realtimex_sdk/contract.py`

This is currently too thin. It is mostly a discovery/client module plus callback helpers.

It should reach parity with the TypeScript contract module by adding:

- `compile_capabilities()`
- `set_local_capability_manifest()`
- `get_compiled_capabilities()`
- `sync_local_capabilities()`
- `handle_invoke_request()`
- `create_invoke_handler()`
- `handle_preflight_request()`
- `create_contract_router()`
- `publish_skills()`

#### `python/realtimex_sdk/client.py`

Keep `RealtimeXSDK` orchestration here, but wire the richer contract module into the top-level client exactly as TS does.

#### New Python files to add

Recommended new Python modules:

- `python/realtimex_sdk/contract_types.py`
- `python/realtimex_sdk/contract_compile.py`
- `python/realtimex_sdk/contract_router.py`
- `python/realtimex_sdk/contract_policy.py`
- `python/realtimex_sdk/contract_publish.py`
- `python/realtimex_sdk/contract_errors.py`

This mirrors the TS structure and avoids a monolithic `contract.py`.

## Migration Plan

### Phase 1: Consolidate TypeScript

1. Extract compiler from `modules/contract.ts` into `core/contract/CapabilityCompiler.ts`.
2. Extract invoke adapter into `core/contract/InvokeEngine.ts` and `ContractRouter.ts`.
3. Add `preflight` and `health`.
4. Add publisher primitives.
5. Keep current public TS methods as wrappers for compatibility.

### Phase 2: Define stable SDK contract API

Public TS API target:

- `sdk.contract.compileCapabilities()`
- `sdk.contract.createContractRouter()`
- `sdk.contract.publishSkills()`
- `sdk.contract.createClient()`

Optional convenience:

- `defineLocalApp()`

### Phase 3: Bring Python to parity

1. Port compiler behavior first.
2. Port invoke adapter.
3. Add preflight/router/publisher.
4. Match normalized errors and response shapes.
5. Add parity tests against the same fixtures.

### Phase 4: Update docs and examples

Shift docs from:

- "SDK is a lightweight Main App client"

to:

- "SDK is the Local App contract runtime and host integration layer"

The current root README still describes the older host-centric architecture and should be updated after the new SDK surface exists.

## Testing Strategy

Add shared fixtures for both languages:

- compile migration fixture
- invoke success fixture
- invoke missing args fixture
- preflight preprocessing fixture
- approval required fixture
- skill publishing fixture

Provider/tooling validation should test that:

- direct API path works from generated skill artifacts
- host `contracts.*` wrappers call the same APIs
- responses are identical regardless of entrypoint

## Recommended First Implementation Slice

The best first slice in this repo is not Python. It is:

1. finish the TypeScript contract runtime surface
2. make it internally coherent
3. freeze the public TS API
4. port that shape to Python

Concretely:

1. Add `createContractRouter()` in TypeScript.
2. Add `handlePreflightRequest()` in TypeScript.
3. Add `publishSkills()` in TypeScript.
4. Refactor `modules/contract.ts` into facade + focused core modules.
5. Only then implement the same API in Python.

That yields the fastest path to a good Local App DX while keeping the SDK architecture defensible.
