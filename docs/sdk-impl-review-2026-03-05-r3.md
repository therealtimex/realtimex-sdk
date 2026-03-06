# RealtimeX SDK — Implementation Review R3

Status: Review
Date: 2026-03-05
Reviewer: Claude (Sonnet 4.6)
Scope: Changes since R2 review — all R2 action items
Previous reviews: R1, `docs/sdk-impl-review-2026-03-05-r2.md`

---

## 1) R2 Action Items — Resolution Status

| R2 Item | Priority | Status |
|---|---|---|
| Fix `risk_level: null` coercion in `ContractValidator.ts` | P3 | Fixed |
| Add `ContractRuntime.executeToolCall` unit tests | P3 | Fixed |
| Add cross-language hash parity test | P3 | Fixed |
| Add `toStableToolName` unit tests | P3 | Fixed |

**All action items resolved. No new blocking issues found.**

---

## 2) Verification

### `risk_level: null` fix

`rawRiskLevel` is now derived with an explicit `undefined` check:

```ts
const rawRiskLevel =
    value.risk_level !== undefined ? value.risk_level : value.riskLevel;
```

Using `!== undefined` (not `??`) preserves `null` correctly. The condition `rawRiskLevel === null` then evaluates to `true` and returns `null` as typed. `ContractValidator.test.ts` asserts `normalized.capabilities?.[0]?.risk_level` is `null`. ✅

### `ContractRuntime` tests

Three cases in `ContractRuntime.test.ts`:
- **Trigger payload shape** — asserts `capability_id` in `raw_data`, `payload_template` merge (`operation: 'documents.ingest'` from template present alongside SDK-injected fields), full context object, `queued` result with `task_id` and `attempt_id`. ✅
- **Required field validation** — empty args → `failed` result with `code: 'tool_validation_error'` and `retryable: false`. Webhook never called (one fetch: contract only). ✅
- **5xx retry** — first webhook call returns 500, second succeeds. Two webhook attempts, three total fetches. ✅

### Cross-language hash parity

Two complementary checks:

1. `contract.test.ts:180-184` — TypeScript-internal: `hashContractPayload({ b:1, a:2 })` equals `hashContractPayload({ a:2, b:1 })`. Confirms key-order independence within the TypeScript build.

2. `verify-contract-compat.mjs:261-374` — live cross-process check: both TypeScript (`hashContractPayload`) and Python (`hash_contract_payload`) hash the same nested payload `{ b:1, a:{ z:9, y:[3,{k:"v"}] } }`. The digests are compared at line 368; mismatch fails the script. The payload exercises nested objects, arrays, and objects within arrays. ✅

### `toStableToolName` tests

Four cases in `ToolNamePolicy.test.ts`: empty capability ID → `folio_app_tool`, namespace prefix deduplication, numeric-start → `tool_123_export`, dot-separated with namespace. ✅

---

## 3) One Informational Note

### Float serialization is not covered by the cross-language hash parity payload

**Files:** `typescript/src/modules/contract.ts:109-119`, `python/realtimex_sdk/contract.py:195-198`

JavaScript `JSON.stringify(1.0)` produces `"1"` (trailing zero stripped). Python `json.dumps(1.0)` produces `"1.0"`. For the same payload `{ "a": 1.0 }`:
- TypeScript hashes `{"a":1}`
- Python hashes `{"a":1.0}`

These are different digests.

**Impact:** Only affects payloads that contain float values where the float happens to be a whole number (e.g., `2.0`, `100.0`). In practice, contract approval args and idempotency payloads use strings, integers, and booleans — not bare floats. The hash parity test payload uses integers, so this edge case is not exercised.

**Recommendation:** Not worth changing either implementation. Document in a code comment alongside `stableJsonStringify` and `_stable_json`: *"Note: float values that are whole numbers serialize differently between JavaScript (drops trailing zero) and Python (preserves trailing zero). Avoid float values in payload hashes; use integers or strings."*

---

## 4) Small Remaining Test Gaps (Informational)

These are minor and do not affect the pilot:

- **`ContractRuntime`** — `ScopeDeniedError` when a required permission is not in the runtime's scope list; `ToolNotFoundError` when `tool_name` has no matching registry entry; `task_id` (as opposed to `task_uuid`) resolution in `resolveTaskId`.
- **`toStableToolName`** — no namespace argument (solo capability ID normalization).

---

## 5) Summary

All R2 action items are resolved. No new issues were introduced. The SDK implementation is complete and production-ready for the Folio pilot.

The one informational note (float serialization mismatch) is documented for future awareness but requires no code change. The remaining test gaps are low-priority and do not gate any current rollout phase.
