# RealtimeX SDK — Implementation Review R2

Status: Review
Date: 2026-03-05
Reviewer: Claude (Sonnet 4.6)
Scope: Changes since R1 review — all R1 action items
Previous review: `docs/sdk-impl-review-2026-03-05.md`

---

## 1) R1 Action Items — Resolution Status

| R1 Item | Priority | Status |
|---|---|---|
| Fix `hashContractPayload` — use sorted key serialization in TypeScript | P1 | Fixed |
| Fix `verify-contract-compat.mjs` — stale `contract.version` / `supported_events` field names | P1 | Fixed |
| Add agentic fields to `ContractCapability` SDK type | P2 | Fixed |
| Fix dead branch in `normalizeTrigger` | P2 | Fixed |
| Align `ContractModule.invoke` to send `capability_id` instead of `capability` | P2 | Fixed |
| Add recursion guard in permission escalation (`_request` / `request`) | P3 | Fixed |
| `ScopeGuard` open-by-default observation | Minor | Unchanged (acceptable) |

**All action items resolved. The SDK is functionally correct and ready for Folio pilot expansion.**

---

## 2) Verification of Key Fixes

### `stableJsonStringify` (Issue 1)

`hashContractPayload` in `contract.ts:106` now calls `stableJsonStringify` (lines 109–119):

```ts
function stableJsonStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        const keys = Object.keys(record).sort();
        return `{${keys.map(...).join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}
```

Python's `_stable_json` uses `json.dumps(value, sort_keys=True, separators=(",", ":"))`. Both produce identical output for all JSON-compatible types (`null`, booleans, numbers, strings, sorted-key objects, arrays). Cross-language hash parity is now correct. ✅

### `verify-contract-compat.mjs` (Issue 2)

Two helper functions added:
- `resolveContractVersion(contract)` — checks `contract_version || version || id || ""`
- `resolveSupportedEvents(contract)` — checks `supported_contract_events` then `supported_events`

Both `compareEventSets` calls now use `resolveSupportedEvents(mainAppContract)` / `resolveSupportedEvents(tsContract|pyContract)`. The final event count log also uses `resolveSupportedEvents`. All three places are consistent. ✅

### `ContractCapability` type and `normalizeCapability` (Issue 3)

`contract.ts` interface now includes: `execution_mode`, `approval_required`, `approval_policy`, `allowed_preprocessing`, `allowed_side_effects`, `network_policy`, `artifact_policy`, `tags`, `examples`, `risk_level`, `enabled`, `metadata`. ✅

`normalizeCapability` in `ContractValidator.ts` threads all new fields through with camelCase/snake_case dual-support (e.g., `value.execution_mode ?? value.executionMode`). `normalizeExecutionMode` validates the three known values. ✅

### `normalizeTrigger` (Issue 4)

Dead branch replaced with:
```ts
if (rawEvent && rawEvent !== 'task.trigger') {
    throw new ContractValidationError('Unsupported trigger event', { event: rawEvent });
}
const event = 'task.trigger' as const;
```
Throws for unknown trigger events, hardcodes the only valid value. ✅

### `ContractModule.invoke` `capability_id` (Issue 5)

```ts
if (!args.capability_id) {
    args.capability_id = capabilityId;
}
```
Now consistent with `ContractRuntime.buildTriggerRequestBody` which also sends `capability_id`. ✅

### Permission escalation recursion guard (P3)

Both languages guard with `MAX_PERMISSION_REQUEST_RETRIES = 1`:
- TypeScript: `permissionRetryCount = 0` parameter; throws `PermissionDeniedError(permission, message, 'PERMISSION_REQUIRED')` once the limit is reached ✅
- Python: `permission_retry_count: int = 0` parameter; raises `PermissionDeniedError(permission, message, "PERMISSION_REQUIRED")` at limit ✅
- `PermissionDeniedError` updated to accept an optional `code` argument (defaults to `'PERMISSION_DENIED'`), so the `'PERMISSION_REQUIRED'` case is now distinguishable by callers. ✅

### New tests

- `ACPEventMapper.test.ts` — lifecycle status mapping, queued→in_progress result update, canceled event with `cancelled: true` metadata ✅
- `ACPPermissionBridge.test.ts` — disabled bridge, missing `notifier.request` (fail-closed), allow decision, deny decision, transport throw ✅

---

## 3) One Minor Issue Found

### `risk_level: null` Is Coerced to `undefined` by `??` Operator

**File:** `typescript/src/core/contract/ContractValidator.ts:168-178`

```ts
risk_level:
    value.risk_level === 'low' || ... || value.risk_level === null || ...
        ? ((value.risk_level ?? value.riskLevel) as ContractCapability['risk_level'])
        : undefined,
```

When `value.risk_level` is `null` (the server explicitly signals "no risk level"), the condition is true (because `value.risk_level === null`). The ternary then evaluates `value.risk_level ?? value.riskLevel` = `null ?? value.riskLevel`. Since `??` returns the right-hand side when the left is `null`, if `value.riskLevel` is `undefined`, the result is `undefined` — not `null`.

**Impact:** A server payload of `{ risk_level: null }` normalizes to `{ risk_level: undefined }` in the SDK. The type allows `null` as a valid value but the normalizer silently drops it.

**Fix:**
```ts
const rawRiskLevel = value.risk_level ?? value.riskLevel;
risk_level:
    rawRiskLevel === 'low' || rawRiskLevel === 'medium' || rawRiskLevel === 'high' || rawRiskLevel === null
        ? (rawRiskLevel as ContractCapability['risk_level'])
        : undefined,
```

This is low severity: in practice `null` and `undefined` both mean "not set" for this field. The current behavior is incorrect relative to the type definition but has no operational impact.

---

## 4) Remaining Test Coverage Gaps (Carried P3)

From R1, still not addressed:

- **`ContractRuntime.executeToolCall` — no unit tests.** The trigger path, retry behavior, `validateToolArgs` required-field enforcement, and `buildTriggerRequestBody` shape are untested. The `RetryPolicy` itself is also untested.
- **Cross-language hash parity test.** No test asserts that `hashContractPayload` in TypeScript and `hash_contract_payload` in Python produce the same digest for a reference payload with multi-key objects and nested arrays.
- **`toStableToolName` — no dedicated tests.** The name-derivation logic (`normalizeToken`, prefix deduplication, numeric prefix handling) is a load-bearing function with no coverage.

---

## 5) Rollout Readiness

| Area | R1 Status | R2 Status |
|---|---|---|
| Cross-language signature compatibility | Broken | Fixed |
| Contract compat verify script | Broken (stale fields) | Fixed |
| Agentic capability metadata surfaced to adapters | Missing | Fixed |
| Permission escalation safety | Recursive | Fixed |
| Folio pilot expansion | Blocked (P1 bugs) | Ready |
| Multi-app generalization | Blocked (P2 gaps) | Ready |

---

## 6) Action Items

### P3 — Quality (pre-generalization)

1. **Fix `risk_level: null` coercion** in `ContractValidator.ts:168-178`. Normalize via `rawRiskLevel` intermediary rather than re-evaluating `value.risk_level ?? value.riskLevel` in the ternary body.

2. **Add `ContractRuntime.executeToolCall` unit tests** — at minimum: trigger body shape (`capability_id` in `raw_data`), `validateToolArgs` rejects missing required field, 5xx response triggers retry, task_uuid response returns `queued` status.

3. **Add cross-language hash parity test** (or inline assertion in `verify-contract-compat.mjs`) confirming `hashContractPayload({ b: 1, a: 2 })` produces the same hex digest in both TypeScript and Python.

4. **Add `toStableToolName` unit tests** — empty capability_id, namespace prefix deduplication, numeric-start capability, dot-separated capability ID.
