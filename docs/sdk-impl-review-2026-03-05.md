# RealtimeX SDK — Implementation Review

Status: Review
Date: 2026-03-05
Reviewer: Claude (Sonnet 4.6)
Scope: Full SDK source — TypeScript (`typescript/src/`) and Python (`python/realtimex_sdk/`)
Ref: Server-side agentic contract flow @ `realtimex-ai-app` branch `local-app-contracts`

---

## 1) Summary

The SDK is well-structured. The TypeScript core (`ContractRuntime`, `ContractCache`, `ContractValidator`, `ToolProjector`, `RetryPolicy`, `ScopeGuard`) is clean and correctly isolated. The ACP layer (`ACPContractAdapter`, `ACPEventMapper`, `ACPPermissionBridge`, `ACPTelemetry`) is solid: references are correctly correlated by `task_id`, notify failures are caught and re-attempted without re-throwing, and the lifecycle event ordering is safe (reference stored before emit). The Python module is a faithful parallel of the TypeScript `ContractModule`.

Five issues require attention before the Folio pilot expansion.

---

## 2) Issues

### Issue 1 — Cross-Language `hashContractPayload` Mismatch (P1)

**Files:** `typescript/src/modules/contract.ts:105`, `python/realtimex_sdk/contract.py:108-111`

TypeScript:
```ts
return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
```

Python:
```python
encoded = str(normalized if isinstance(normalized, str) else _stable_json(normalized)).encode("utf-8")
return hashlib.sha256(encoded).hexdigest()
```

`_stable_json` uses `json.dumps(value, sort_keys=True, separators=(",", ":"))`.
`JSON.stringify` in Node/V8 preserves insertion order with no key sort.

For a payload `{ "b": 1, "a": 2 }`:
- TypeScript hashes `{"b":1,"a":2}`
- Python hashes `{"a":2,"b":1}` (sorted keys)

**Impact:** Any cross-language signature verification (`signContractEvent` / `sign_contract_event`) or idempotency key comparison (`buildContractIdempotencyKey`) will silently produce different digests for the same payload when the object has non-alphabetically-ordered keys. A TypeScript-signed event will fail verification by Python code.

**Fix:** Add `JSON.stringify` with sorted keys in TypeScript:
```ts
function stableJsonStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJsonStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        const keys = Object.keys(value as object).sort();
        return `{${keys.map(k => `${JSON.stringify(k)}:${stableJsonStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}
```

---

### Issue 2 — `verify-contract-compat.mjs` Checks Stale Field Name (P1)

**File:** `scripts/verify-contract-compat.mjs:47`

```js
if (contract.version !== LOCAL_APP_CONTRACT_VERSION) {
```

The server's contract response now uses `contract_version` as the primary field (the `ContractValidator` reads `contract.contract_version` first at `typescript/src/core/contract/ContractValidator.ts:134`). The verify script checks `contract.version`, not `contract.contract_version`.

If the server response no longer includes a `version` alias, `contract.version` will be `undefined` and the assertion will fail (or pass vacuously with the wrong comparison). The script will also compare `mainAppContract.supported_events` vs `tsContract.supported_events` at line 236 — but the `ContractModule` returns the raw server payload which may use `supported_contract_events` rather than `supported_events` depending on the current server response shape.

**Fix:** Update `assertContractShape` to accept either field:
```js
const contractVersion = contract.contract_version || contract.version || contract.id;
if (contractVersion !== LOCAL_APP_CONTRACT_VERSION) { ... }
```
And update `compareEventSets` calls to resolve `supported_contract_events || supported_events`.

---

### Issue 3 — `ContractCapability` SDK Type Missing Agentic Fields (P2)

**File:** `typescript/src/core/types/contract.ts:20-28`

The SDK `ContractCapability` interface:
```ts
export interface ContractCapability {
    capability_id: string;
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
    output_schema?: Record<string, unknown>;
    permission: string;
    trigger: ContractCapabilityTrigger;
}
```

The server's `normalizeCapability()` now returns additional fields used by the agentic contract flow: `execution_mode`, `approval_policy`, `approval_required`, `allowed_preprocessing`, `allowed_side_effects`, `network_policy`, `artifact_policy`, `tags`, `examples`, `metadata`.

The `normalizeCapability` in `ContractValidator.ts` (`typescript/src/core/contract/ContractValidator.ts:101-109`) copies only the typed fields — extra server fields are silently dropped. An AI agent host using the SDK's `CanonicalToolDefinition` (which inherits from `ContractCapability`) will never see `execution_mode`, `approval_policy`, or `tags` even if the server sends them.

**Impact:** Medium for Folio pilot (no enforcement expected client-side), higher as the contract flow matures and hosts need to surface `execution_mode` to present accurate capability descriptions.

**Fix:** Add the agentic fields as optional to `ContractCapability` and thread them through `normalizeCapability` in `ContractValidator.ts`. At minimum add `execution_mode`, `approval_required`, and `tags` to the interface.

---

### Issue 4 — Dead Branch in `normalizeTrigger` (P2)

**File:** `typescript/src/core/contract/ContractValidator.ts:70`

```ts
const event = value.event === 'task.trigger' ? 'task.trigger' : 'task.trigger';
```

Both branches return the same literal. The original intent was likely to reject unknown trigger events or map aliases, but as written this is dead code. It silently normalizes any `event` value (including unsupported ones) to `'task.trigger'`.

**Fix:** Either enforce the only valid value explicitly:
```ts
const event = 'task.trigger' as const;
```
Or throw if the value is not `'task.trigger'`:
```ts
if (value.event !== 'task.trigger') {
    throw new ContractValidationError('Unsupported trigger event', { event: value.event });
}
```

---

### Issue 5 — `ContractModule.invoke` Sends Old `capability` Field Instead of `capability_id` (P2)

**File:** `typescript/src/modules/contract.ts:326-328`

```ts
const args: Record<string, unknown> = { ...payload.args };
if (!args.capability) {
    args.capability = capabilityId;
}
```

`ContractModule.invoke` injects `capability` (old field) into `raw_data`. The server's `extractInvokedCapabilityId` reads `raw_data._contract?.capability_id` first, then `raw_data.capability_id`, then `raw_data.capability` as a last fallback. So this still works, but it relies on the legacy fallback path.

By contrast, `ContractRuntime.buildTriggerRequestBody` (`typescript/src/core/runtime/ContractRuntime.ts:324`) correctly sends `capability_id: tool.capability_id` as a top-level field in `raw_data`. The two code paths are inconsistent.

**Fix:** Change `ContractModule.invoke` to inject `capability_id` instead of `capability`:
```ts
if (!args.capability_id) {
    args.capability_id = capabilityId;
}
```

---

## 3) Minor Observations

### 3.1 `ScopeGuard` Open-by-Default When Empty

**File:** `typescript/src/core/auth/ScopeGuard.ts:12`

```ts
if (this.scopes.size === 0) return true;
```

If `ContractRuntimeOptions.permissions` is not provided (defaults to `[]`), all capability permissions pass the scope check. This is intentional ("no restrictions mode") but could silently allow misconfigured runtimes to bypass permission enforcement. Consider logging a warn once when a runtime with non-empty capabilities is invoked without any scopes configured.

### 3.2 Permission Escalation Can Recurse Unboundedly

**Files:** `typescript/src/modules/contract.ts:236-243`, `python/realtimex_sdk/contract.py:250-253`

If `_requestPermission` / `requestPermission` returns `true` but the subsequent retry still returns `403 PERMISSION_REQUIRED` (e.g., due to a server-side bug), both the TypeScript and Python `request` methods will recurse infinitely. A single-retry guard or max-depth counter would prevent a stack overflow in this edge case.

### 3.3 `ContractRuntime` Doesn't Implement Agentic Contract Approval Flow

**File:** `typescript/src/core/runtime/ContractRuntime.ts`

`ContractRuntime.executeToolCall` calls the webhook directly after basic schema validation. It has no concept of approval tokens, `execution_mode` enforcement, or the `contracts.search → contracts.plan → contracts.approve → contracts.invoke` agentic flow defined in the server design. This is expected for the current scope (the runtime is used by AI model hosts that delegate approval to the agent itself via the server-side tools), but the gap should be documented: callers using `ContractRuntime` bypass server-side `approval_policy` enforcement unless the server enforces it independently on the webhook endpoint.

### 3.4 `ContractRuntime` and `ContractClient` Use Separate HTTP Clients

`RealtimeXSDK` constructs both `this.contract = new ContractModule(...)` and `this.contractRuntime = new ContractRuntime(...)`. Each manages its own HTTP client, cache, and retry policy. For the same underlying app, contract data may be fetched twice (once via `ContractModule`, once via `ContractRuntime`'s `ContractClient`). The caches are independent and won't share entries. Low impact for Folio (single app, small contract), but worth noting for multi-app scenarios.

---

## 4) Test Coverage

**Present:**
- `ContractModule` — capability discovery, search, describe, invoke, cache hits, `auto_run` validation (`contract.test.ts`)
- `ACPContractAdapter` — task_id correlation, permission denial, callback ingestion (`ACPContractAdapter.test.ts`)
- `ACPEventMapper`, `ACPPermissionBridge` — (test files present)

**Missing:**
- `ContractRuntime.executeToolCall` — no unit tests for the HTTP trigger path, retry behavior, `validateToolArgs`, `buildTriggerRequestBody` structure
- `hashContractPayload` cross-language parity — no test asserting TypeScript and Python produce the same hash for equivalent payloads
- `normalizeLocalAppContractV1` with the new `contract_version` field name (currently tested against `id`/`version` aliases)
- `ScopeGuard` with wildcard or empty permission — no test confirming open-by-default behavior
- `toStableToolName` — important name-mapping function with no dedicated test

---

## 5) Action Items

### P1 — Fix Before Pilot Expansion

1. **Fix `hashContractPayload` in TypeScript** to use sorted key serialization, matching Python's `_stable_json`. (`typescript/src/modules/contract.ts:105`)

2. **Fix `verify-contract-compat.mjs`** to read `contract_version || version || id` and resolve `supported_contract_events || supported_events`. (`scripts/verify-contract-compat.mjs:47,236`)

### P2 — Fix Before Multi-App Generalization

3. **Add agentic fields to `ContractCapability` SDK type**: `execution_mode`, `approval_required`, `tags`, `examples`. Thread through `normalizeCapability` in `ContractValidator.ts`. (`typescript/src/core/types/contract.ts`)

4. **Fix dead branch in `normalizeTrigger`**: enforce `'task.trigger'` explicitly or throw on unsupported values. (`typescript/src/core/contract/ContractValidator.ts:70`)

5. **Align `ContractModule.invoke` to send `capability_id`** instead of `capability` in `raw_data`. (`typescript/src/modules/contract.ts:326`)

### P3 — Quality

6. **Add `ContractRuntime` unit tests**: trigger path, retry, `validateToolArgs` edge cases, `buildTriggerRequestBody` structure.

7. **Add cross-language hash parity test** or a note in the verify script asserting that both languages produce the same `hashContractPayload` for a reference payload.

8. **Add a recursion guard in `ContractModule._request` / `request`** for the `403 PERMISSION_REQUIRED` re-try path. A max depth of 1 retry is sufficient.
