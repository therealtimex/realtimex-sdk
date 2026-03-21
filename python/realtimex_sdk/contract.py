"""
Contract Module - Discover, compile, execute, and publish Local App contracts.
"""

import hashlib
import hmac
import inspect
import json
import os
import re
import shutil
import uuid
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional, Union
from urllib.parse import quote

import httpx

from .api import PermissionDeniedError

LOCAL_APP_CONTRACT_VERSION = "local-app-contract/v1"
CONTRACT_SIGNATURE_HEADER = "x-rtx-contract-signature"
CONTRACT_EVENT_ID_HEADER = "x-rtx-event-id"
CONTRACT_SIGNATURE_ALGORITHM = "sha256"
CONTRACT_ATTEMPT_PREFIX = "run-"
DEFAULT_CONTRACT_TRIGGER_ROUTE = "/webhooks/realtimex"
DEFAULT_SKILL_PREFLIGHT_PATH = "/api/contracts/preflight"
DEFAULT_SKILL_INVOKE_PATH = "/api/contracts/invoke"
DEFAULT_SKILL_HEALTH_PATH = "/api/contracts/health"
DEFAULT_SKILL_BASE_URL = "http://127.0.0.1:<local_app_port>"
INDEX_FILE = "index.json"
SKILL_FILE = "SKILL.md"
SKILL_METADATA_FILE = "skill.json"

CapabilityHandler = Callable[[Dict[str, Any]], Union[Dict[str, Any], Awaitable[Dict[str, Any]], None]]

_EVENT_ALIASES: Dict[str, str] = {
    "trigger-agent": "task.trigger",
    "task.trigger": "task.trigger",
    "ping": "system.ping",
    "system.ping": "system.ping",
    "claim": "task.claimed",
    "claimed": "task.claimed",
    "task.claimed": "task.claimed",
    "task-start": "task.started",
    "start": "task.started",
    "task.started": "task.started",
    "task-progress": "task.progress",
    "progress": "task.progress",
    "processing": "task.progress",
    "task.progress": "task.progress",
    "task-complete": "task.completed",
    "complete": "task.completed",
    "completed": "task.completed",
    "task.completed": "task.completed",
    "task-fail": "task.failed",
    "fail": "task.failed",
    "failed": "task.failed",
    "task.failed": "task.failed",
    "task-cancel": "task.canceled",
    "task-cancelled": "task.canceled",
    "task-canceled": "task.canceled",
    "cancel": "task.canceled",
    "cancelled": "task.canceled",
    "canceled": "task.canceled",
    "task.canceled": "task.canceled",
}

_LEGACY_ACTION_MAP: Dict[str, str] = {
    "task.trigger": "trigger-agent",
    "system.ping": "ping",
    "task.claimed": "claim",
    "task.started": "start",
    "task.progress": "progress",
    "task.completed": "complete",
    "task.failed": "fail",
    "task.canceled": "cancel",
}


def normalize_contract_event(event_like: Optional[str]) -> Optional[str]:
    if not event_like or not isinstance(event_like, str):
        return None
    return _EVENT_ALIASES.get(event_like.strip().lower())


def normalize_attempt_id(attempt_like: Optional[Union[str, int]]) -> Optional[str]:
    if attempt_like is None:
        return None
    if isinstance(attempt_like, int) and attempt_like > 0:
        return f"{CONTRACT_ATTEMPT_PREFIX}{attempt_like}"
    if not isinstance(attempt_like, str):
        return None
    trimmed = attempt_like.strip()
    if not trimmed:
        return None
    if trimmed.startswith(CONTRACT_ATTEMPT_PREFIX):
        return trimmed
    if trimmed.isdigit():
        return f"{CONTRACT_ATTEMPT_PREFIX}{trimmed}"
    return trimmed


def parse_attempt_run_id(attempt_like: Optional[Union[str, int]]) -> Optional[int]:
    attempt_id = normalize_attempt_id(attempt_like)
    if not attempt_id:
        return None

    lowered = attempt_id.lower()
    for prefix in ("run-", "run_", "run:"):
        if lowered.startswith(prefix):
            numeric = lowered[len(prefix):]
            if numeric.isdigit():
                value = int(numeric)
                return value if value > 0 else None
            return None

    if lowered.startswith("run") and lowered[3:].isdigit():
        value = int(lowered[3:])
        return value if value > 0 else None
    return None


def hash_contract_payload(payload: Any) -> str:
    normalized = payload if isinstance(payload, dict) else {"value": payload}
    encoded = str(normalized if isinstance(normalized, str) else _stable_json(normalized)).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def create_contract_event_id() -> str:
    return str(uuid.uuid4())


def build_contract_signature_message(
    event_id: Optional[str],
    event_type: str,
    task_id: str,
    attempt_id: Optional[Union[str, int]],
    timestamp: Optional[str],
    payload: Any,
) -> str:
    canonical_event = normalize_contract_event(event_type) or event_type
    return ".".join(
        [
            str(event_id or ""),
            str(canonical_event or ""),
            str(task_id or ""),
            str(normalize_attempt_id(attempt_id) or ""),
            str(timestamp or ""),
            hash_contract_payload(payload if payload is not None else {}),
        ]
    )


def sign_contract_event(
    secret: str,
    event_id: Optional[str],
    event_type: str,
    task_id: str,
    attempt_id: Optional[Union[str, int]],
    timestamp: Optional[str],
    payload: Any,
) -> str:
    message = build_contract_signature_message(
        event_id=event_id,
        event_type=event_type,
        task_id=task_id,
        attempt_id=attempt_id,
        timestamp=timestamp,
        payload=payload,
    )
    digest = hmac.new(
        secret.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{CONTRACT_SIGNATURE_ALGORITHM}={digest}"


def canonical_event_to_legacy_action(event_like: str) -> Optional[str]:
    canonical = normalize_contract_event(event_like)
    if not canonical:
        return None
    return _LEGACY_ACTION_MAP.get(canonical)


def build_contract_idempotency_key(
    task_id: str,
    event_type: str,
    event_id: Optional[str] = None,
    attempt_id: Optional[Union[str, int]] = None,
    machine_id: Optional[str] = None,
    timestamp: Optional[str] = None,
    payload: Any = None,
) -> str:
    canonical = normalize_contract_event(event_type) or event_type
    if event_id:
        token = hashlib.sha256(str(event_id).encode("utf-8")).hexdigest()
        return f"{task_id}:{canonical}:event:{token}"

    hash_input = {
        "task_id": task_id,
        "event_type": canonical,
        "attempt_id": normalize_attempt_id(attempt_id),
        "machine_id": machine_id,
        "timestamp": timestamp,
        "payload_hash": hash_contract_payload(payload if payload is not None else {}),
    }
    token = hashlib.sha256(_stable_json(hash_input).encode("utf-8")).hexdigest()
    return f"{task_id}:{canonical}:hash:{token}"


def _stable_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _is_record(value: Any) -> bool:
    return isinstance(value, dict)


def _normalize_string_list(
    value: Any,
    transform: Optional[Callable[[str], str]] = None,
) -> List[str]:
    if not isinstance(value, list):
        return []
    normalized: List[str] = []
    seen = set()
    for entry in value:
        if not isinstance(entry, str):
            continue
        candidate = entry.strip()
        if transform:
            candidate = transform(candidate)
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        normalized.append(candidate)
    return normalized


def _normalize_error_codes(value: Any) -> List[str]:
    def _transform(entry: str) -> str:
        normalized = re.sub(r"[^A-Z0-9]+", "_", entry.upper()).strip("_")
        return normalized

    return _normalize_string_list(value, _transform)


def _normalize_execution_mode(value: Any) -> Dict[str, Any]:
    if not isinstance(value, str) or not value.strip():
        return {"value": "delegate_only", "migrated": True, "invalid": False}
    normalized = value.strip().lower()
    if normalized in ("delegate_only", "assist_then_delegate", "agent_only"):
        return {
            "value": normalized,
            "migrated": normalized != value,
            "invalid": False,
        }
    return {"value": "delegate_only", "migrated": True, "invalid": True}


def _normalize_risk_level(value: Any) -> Dict[str, Any]:
    if value in (None, ""):
        return {"value": None, "migrated": False, "invalid": False}
    if not isinstance(value, str):
        return {"value": None, "migrated": True, "invalid": True}
    normalized = value.strip().lower()
    if normalized in ("low", "medium", "high"):
        return {
            "value": normalized,
            "migrated": normalized != value,
            "invalid": False,
        }
    return {"value": None, "migrated": True, "invalid": True}


def _normalize_idempotency(value: Any) -> Optional[Dict[str, Any]]:
    if not _is_record(value):
        return None
    key_fields = _normalize_string_list(
        value.get("key_fields", value.get("keyFields")),
        lambda entry: entry,
    )
    if not key_fields:
        return None
    return {"key_fields": key_fields}


def _normalize_capability_config_entries(value: Any) -> List[Dict[str, Any]]:
    if not isinstance(value, list):
        return []
    entries: List[Dict[str, Any]] = []
    seen = set()
    for entry in value:
        if isinstance(entry, str) and entry.strip():
            key = entry.strip()
            dedupe_key = key.lower()
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            entries.append({"key": key})
            continue
        if not _is_record(entry):
            continue
        key_candidate = next(
            (
                candidate
                for candidate in (
                    entry.get("key"),
                    entry.get("name"),
                    entry.get("id"),
                    entry.get("field"),
                )
                if isinstance(candidate, str) and candidate.strip()
            ),
            None,
        )
        if not key_candidate:
            continue
        key = key_candidate.strip()
        dedupe_key = key.lower()
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        normalized_entry = {"key": key}
        if isinstance(entry.get("description"), str) and entry["description"].strip():
            normalized_entry["description"] = entry["description"].strip()
        if isinstance(entry.get("source"), str) and entry["source"].strip():
            normalized_entry["source"] = entry["source"].strip()
        if entry.get("sensitive") is True:
            normalized_entry["sensitive"] = True
        entries.append(normalized_entry)
    return entries


def _normalize_capability_configuration(capability: Dict[str, Any]) -> Dict[str, Any]:
    migrated = False
    source = None
    if _is_record(capability.get("configuration")):
        source = capability.get("configuration")
    elif _is_record(capability.get("config_requirements")):
        source = capability.get("config_requirements")
        migrated = True
    elif _is_record(capability.get("configRequirements")):
        source = capability.get("configRequirements")
        migrated = True

    if not _is_record(source):
        return {"configuration": None, "migrated": migrated}

    required_source = source.get("required", source.get("required_fields", source.get("requiredFields")))
    optional_source = source.get("optional", source.get("optional_fields", source.get("optionalFields")))
    if "required_fields" in source or "requiredFields" in source:
        migrated = True
    if "optional_fields" in source or "optionalFields" in source:
        migrated = True

    setup_steps_source = source.get("setup_steps", source.get("setupSteps", source.get("steps")))
    if "setupSteps" in source or "steps" in source:
        migrated = True

    configuration = {
        "required": _normalize_capability_config_entries(required_source),
        "optional": _normalize_capability_config_entries(optional_source),
        "setup_steps": _normalize_string_list(setup_steps_source, lambda entry: entry),
        "notes": _normalize_string_list(source.get("notes"), lambda entry: entry),
    }
    has_values = any(configuration[key] for key in ("required", "optional", "setup_steps", "notes"))
    return {"configuration": configuration if has_values else None, "migrated": migrated}


def _normalize_capability_preflight(capability: Dict[str, Any]) -> Dict[str, Any]:
    source = capability.get("preflight") if _is_record(capability.get("preflight")) else None
    if not _is_record(source):
        return {"preflight": None, "migrated": False}
    required_preprocessing = _normalize_string_list(
        source.get("required_preprocessing", source.get("requiredPreprocessing")),
        lambda entry: entry.lower(),
    )
    return {
        "preflight": {"required_preprocessing": required_preprocessing} if required_preprocessing else None,
        "migrated": "requiredPreprocessing" in source,
    }


def _normalize_header_record(value: Any) -> Dict[str, str]:
    if not _is_record(value):
        return {}
    headers: Dict[str, str] = {}
    for raw_key, raw_value in value.items():
        key = str(raw_key or "").strip()
        if not key or raw_value is None:
            continue
        header_value = str(raw_value).strip()
        if not header_value:
            continue
        headers[key] = header_value
    return headers


def _normalize_delivery_mode(value: Any) -> str:
    if not isinstance(value, str):
        return "webhook"
    return "api" if value.strip().lower() == "api" else "webhook"


def _normalize_delivery(capability: Dict[str, Any]) -> Dict[str, Any]:
    migrated = False
    source = capability.get("delivery") if _is_record(capability.get("delivery")) else {}
    mode = _normalize_delivery_mode(
        source.get("mode", capability.get("deliveryMode", "api" if _is_record(source.get("api")) else None))
    )
    if "deliveryMode" in capability or "deliveryApi" in capability:
        migrated = True

    webhook_source = source.get("webhook") if _is_record(source.get("webhook")) else {}
    webhook_route = webhook_source.get("route") if isinstance(webhook_source.get("route"), str) else ""
    webhook_route = webhook_route.strip() or DEFAULT_CONTRACT_TRIGGER_ROUTE

    if mode != "api":
        return {
            "delivery": {
                "mode": "webhook",
                "webhook": {"route": webhook_route},
                "api": None,
            },
            "migrated": migrated,
        }

    api_source = {}
    if _is_record(source.get("api")):
        api_source = source["api"]
    elif _is_record(capability.get("deliveryApi")):
        api_source = capability["deliveryApi"]
        migrated = True

    method_raw = api_source.get("method") if isinstance(api_source.get("method"), str) else ""
    method = method_raw.strip().upper()
    if method not in ("GET", "POST", "PUT", "PATCH", "DELETE"):
        method = "POST"

    route_path = str(
        api_source.get("path", api_source.get("route", api_source.get("url", "")))
    ).strip()
    payload_template = (
        api_source.get("payload_template")
        if _is_record(api_source.get("payload_template"))
        else api_source.get("payloadTemplate")
        if _is_record(api_source.get("payloadTemplate"))
        else None
    )
    if not _is_record(api_source.get("payload_template")) and _is_record(api_source.get("payloadTemplate")):
        migrated = True

    delivery = {
        "mode": "api",
        "webhook": {"route": webhook_route},
        "api": {
            "method": method,
            "path": route_path,
            "headers": _normalize_header_record(api_source.get("headers")),
        },
    }
    if payload_template:
        delivery["api"]["payload_template"] = payload_template
    return {"delivery": delivery, "migrated": migrated}


def _normalize_capability_trigger(value: Any, default_trigger_route: str) -> Dict[str, Any]:
    migrated = False
    invalid_event = False
    fallback = {"event": "task.trigger", "route": default_trigger_route}

    if not _is_record(value):
        return {"trigger": fallback, "migrated": True, "invalidEvent": False}

    event_value = value.get("event") if isinstance(value.get("event"), str) else ""
    normalized_event = event_value.strip().lower()
    if normalized_event and normalized_event != "task.trigger":
        invalid_event = True
        migrated = True
    elif not event_value:
        migrated = True
    elif event_value != "task.trigger":
        migrated = True

    route_value = value.get("route") if isinstance(value.get("route"), str) else ""
    route_value = route_value.strip()
    if not route_value:
        migrated = True

    payload_template = (
        value.get("payload_template")
        if _is_record(value.get("payload_template"))
        else value.get("payloadTemplate")
        if _is_record(value.get("payloadTemplate"))
        else None
    )
    if not _is_record(value.get("payload_template")) and _is_record(value.get("payloadTemplate")):
        migrated = True

    trigger = {"event": "task.trigger", "route": route_value or default_trigger_route}
    if payload_template:
        trigger["payload_template"] = payload_template
    return {"trigger": trigger, "migrated": migrated, "invalidEvent": invalid_event}


def _normalize_network_policy(capability: Dict[str, Any]) -> Dict[str, Any]:
    source = None
    migrated = False
    if _is_record(capability.get("network_policy")):
        source = capability["network_policy"]
    elif _is_record(capability.get("networkPolicy")):
        source = capability["networkPolicy"]
        migrated = True
    if not _is_record(source):
        return {"network_policy": None, "migrated": migrated}

    policy = {
        "allow_domains": _normalize_string_list(
            source.get("allow_domains", source.get("allowDomains")),
            lambda entry: entry.lower(),
        ),
        "allow_localhost": bool(
            source.get("allow_localhost")
            if source.get("allow_localhost") is not None
            else source.get("allowLocalhost")
        ),
    }
    if "allowDomains" in source or "allowLocalhost" in source:
        migrated = True
    return {"network_policy": policy, "migrated": migrated}


def _normalize_artifact_policy(capability: Dict[str, Any]) -> Dict[str, Any]:
    source = None
    migrated = False
    if _is_record(capability.get("artifact_policy")):
        source = capability["artifact_policy"]
    elif _is_record(capability.get("artifactPolicy")):
        source = capability["artifactPolicy"]
        migrated = True
    if not _is_record(source):
        return {"artifact_policy": None, "migrated": migrated}

    policy = {
        "required": _normalize_string_list(source.get("required"), lambda entry: entry.lower()),
        "provenance_required": bool(
            source.get("provenance_required")
            if source.get("provenance_required") is not None
            else source.get("provenanceRequired")
        ),
    }
    if "provenanceRequired" in source:
        migrated = True
    return {"artifact_policy": policy, "migrated": migrated}


def _normalize_approval_policy(capability: Dict[str, Any]) -> Dict[str, Any]:
    source = None
    migrated = False
    if _is_record(capability.get("approval_policy")):
        source = capability["approval_policy"]
    elif _is_record(capability.get("approvalPolicy")):
        source = capability["approvalPolicy"]
        migrated = True
    if not _is_record(source):
        return {"approval_policy": None, "migrated": migrated}

    mode = source.get("mode") if isinstance(source.get("mode"), str) else None
    policy = {
        "mode": mode or "none",
        "one_time": bool(
            source.get("one_time")
            if source.get("one_time") is not None
            else source.get("oneTime")
        ),
        "ttl_ms": source.get("ttl_ms")
        if isinstance(source.get("ttl_ms"), int)
        else source.get("ttlMs")
        if isinstance(source.get("ttlMs"), int)
        else None,
    }
    if "oneTime" in source or "ttlMs" in source:
        migrated = True
    return {"approval_policy": policy, "migrated": migrated}


def _build_migration_warning(index: int, code: str, message: str, capability_id: Optional[str] = None) -> Dict[str, Any]:
    warning = {"code": code, "index": index, "message": message}
    if capability_id:
        warning["capability_id"] = capability_id
    return warning


def compile_capabilities(
    capabilities: Optional[List[Dict[str, Any]]] = None,
    strict: bool = False,
    default_trigger_route: str = DEFAULT_CONTRACT_TRIGGER_ROUTE,
) -> Dict[str, Any]:
    input_capabilities = capabilities if isinstance(capabilities, list) else []
    warnings: List[Dict[str, Any]] = []
    compiled: List[Dict[str, Any]] = []
    migrated_count = 0
    dropped_count = 0
    resolved_default_trigger_route = default_trigger_route.strip() or DEFAULT_CONTRACT_TRIGGER_ROUTE

    for index, candidate in enumerate(input_capabilities):
        if not _is_record(candidate):
            dropped_count += 1
            warnings.append(
                _build_migration_warning(index, "INVALID_CAPABILITY", "Capability entry must be an object.")
            )
            continue

        migrated = False
        capability_id = str(
            candidate.get("capability_id", candidate.get("capabilityId", candidate.get("id", "")))
        ).strip()
        if not capability_id:
            dropped_count += 1
            warnings.append(
                _build_migration_warning(
                    index,
                    "MISSING_CAPABILITY_ID",
                    "Capability is missing capability_id (or capabilityId/id).",
                )
            )
            continue

        if capability_id != str(candidate.get("capability_id", "")).strip():
            migrated = True

        name = str(candidate.get("name", capability_id)).strip() or capability_id
        if not candidate.get("name"):
            migrated = True

        description = str(candidate.get("description", "")).strip()
        input_schema = (
            candidate.get("input_schema")
            if _is_record(candidate.get("input_schema"))
            else candidate.get("inputSchema")
            if _is_record(candidate.get("inputSchema"))
            else {"type": "object", "additionalProperties": True}
        )
        if not _is_record(candidate.get("input_schema")):
            migrated = True

        output_schema = (
            candidate.get("output_schema")
            if _is_record(candidate.get("output_schema"))
            else candidate.get("outputSchema")
            if _is_record(candidate.get("outputSchema"))
            else None
        )
        if not _is_record(candidate.get("output_schema")) and _is_record(candidate.get("outputSchema")):
            migrated = True

        permission = str(candidate.get("permission", "webhook.trigger")).strip()
        if not candidate.get("permission") or permission != candidate.get("permission"):
            migrated = True

        trigger_result = _normalize_capability_trigger(candidate.get("trigger"), resolved_default_trigger_route)
        if trigger_result["migrated"]:
            migrated = True
        if trigger_result["invalidEvent"]:
            warnings.append(
                _build_migration_warning(
                    index,
                    "INVALID_TRIGGER_EVENT",
                    f'Capability "{capability_id}" trigger.event must be "task.trigger".',
                    capability_id=capability_id,
                )
            )

        delivery_result = _normalize_delivery(candidate)
        if delivery_result["migrated"]:
            migrated = True

        execution_mode_result = _normalize_execution_mode(
            candidate.get("execution_mode", candidate.get("executionMode"))
        )
        if execution_mode_result["migrated"]:
            migrated = True
        if execution_mode_result["invalid"]:
            warnings.append(
                _build_migration_warning(
                    index,
                    "INVALID_EXECUTION_MODE",
                    f'Capability "{capability_id}" had invalid execution_mode and was defaulted to delegate_only.',
                    capability_id=capability_id,
                )
            )

        risk_level_result = _normalize_risk_level(candidate.get("risk_level", candidate.get("riskLevel")))
        if risk_level_result["migrated"]:
            migrated = True
        if risk_level_result["invalid"]:
            warnings.append(
                _build_migration_warning(
                    index,
                    "INVALID_RISK_LEVEL",
                    f'Capability "{capability_id}" had invalid risk_level and was normalized to null.',
                    capability_id=capability_id,
                )
            )

        tags = _normalize_string_list(candidate.get("tags"), lambda entry: entry)
        examples = _normalize_string_list(candidate.get("examples"), lambda entry: entry)
        domain = str(candidate.get("domain", "custom")).strip().lower() or "custom"
        if not candidate.get("domain") or domain != candidate.get("domain"):
            migrated = True

        intent_tags = _normalize_string_list(
            candidate.get("intent_tags", candidate.get("intentTags")),
            lambda entry: entry.lower(),
        )
        if "intentTags" in candidate and "intent_tags" not in candidate:
            migrated = True

        allowed_preprocessing = _normalize_string_list(
            candidate.get("allowed_preprocessing", candidate.get("allowedPreprocessing")),
            lambda entry: entry.lower(),
        )
        if "allowedPreprocessing" in candidate and "allowed_preprocessing" not in candidate:
            migrated = True

        allowed_side_effects = _normalize_string_list(
            candidate.get("allowed_side_effects", candidate.get("allowedSideEffects")),
            lambda entry: entry.lower(),
        )
        if "allowedSideEffects" in candidate and "allowed_side_effects" not in candidate:
            migrated = True

        error_codes = _normalize_error_codes(candidate.get("error_codes", candidate.get("errorCodes")))
        if "errorCodes" in candidate and "error_codes" not in candidate:
            migrated = True

        configuration_result = _normalize_capability_configuration(candidate)
        if configuration_result["migrated"]:
            migrated = True

        preflight_result = _normalize_capability_preflight(candidate)
        if preflight_result["migrated"]:
            migrated = True

        network_policy_result = _normalize_network_policy(candidate)
        if network_policy_result["migrated"]:
            migrated = True

        artifact_policy_result = _normalize_artifact_policy(candidate)
        if artifact_policy_result["migrated"]:
            migrated = True

        approval_policy_result = _normalize_approval_policy(candidate)
        if approval_policy_result["migrated"]:
            migrated = True

        idempotency = _normalize_idempotency(candidate.get("idempotency", candidate.get("idempotencyPolicy")))
        if not _is_record(candidate.get("idempotency")) and _is_record(candidate.get("idempotencyPolicy")):
            migrated = True

        enabled = True if candidate.get("enabled") in (None, "") else bool(candidate.get("enabled"))

        compiled_capability = {
            "capability_id": capability_id,
            "name": name,
            "description": description,
            "input_schema": input_schema,
            "permission": permission,
            "trigger": trigger_result["trigger"],
            "preflight": preflight_result["preflight"],
            "delivery": delivery_result["delivery"],
            "domain": domain,
            "intent_tags": intent_tags,
            "execution_mode": execution_mode_result["value"],
            "allowed_preprocessing": allowed_preprocessing,
            "allowed_side_effects": allowed_side_effects,
            "network_policy": network_policy_result["network_policy"],
            "artifact_policy": artifact_policy_result["artifact_policy"],
            "approval_policy": approval_policy_result["approval_policy"],
            "idempotency": idempotency,
            "error_codes": error_codes,
            "configuration": configuration_result["configuration"],
            "tags": tags,
            "examples": examples,
            "risk_level": risk_level_result["value"],
            "enabled": enabled,
        }
        if output_schema:
            compiled_capability["output_schema"] = output_schema
        compiled.append(compiled_capability)

        if migrated:
            migrated_count += 1

    if strict and warnings:
        summary = "\n".join(
            f'[{entry["code"]}] #{entry["index"]}: {entry["message"]}'
            for entry in warnings
        )
        raise ValueError(f"compile_capabilities strict mode failed:\n{summary}")

    return {
        "contract_version": LOCAL_APP_CONTRACT_VERSION,
        "capabilities": compiled,
        "warnings": warnings,
        "input_count": len(input_capabilities),
        "output_count": len(compiled),
        "migrated_count": migrated_count,
        "dropped_count": dropped_count,
    }


def _is_missing_arg_value(value: Any, field_name: str) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        trimmed = value.strip()
        if not trimmed:
            return True
        if re.match(r"^<[^>]+>$", trimmed):
            return True
        if trimmed == f"<{field_name}>":
            return True
    return False


def _extract_capability_id(body: Dict[str, Any]) -> str:
    payload_raw = body.get("payload", {}).get("raw_data", {}) if _is_record(body.get("payload")) else {}
    candidates = [
        body.get("capability_id"),
        body.get("capabilityId"),
        body.get("capability"),
        payload_raw.get("capability_id") if _is_record(payload_raw) else None,
        payload_raw.get("capability") if _is_record(payload_raw) else None,
    ]
    for candidate in candidates:
        normalized = str(candidate or "").strip()
        if normalized:
            return normalized
    return ""


def _extract_args(body: Dict[str, Any]) -> Dict[str, Any]:
    if _is_record(body.get("args")):
        return dict(body["args"])
    payload_raw = body.get("payload", {}).get("raw_data", {}) if _is_record(body.get("payload")) else {}
    if _is_record(payload_raw) and _is_record(payload_raw.get("args")):
        return dict(payload_raw["args"])
    return {}


def _extract_context(body: Dict[str, Any]) -> Dict[str, Any]:
    if _is_record(body.get("context")):
        return dict(body["context"])
    payload_raw = body.get("payload", {}).get("raw_data", {}) if _is_record(body.get("payload")) else {}
    if _is_record(payload_raw) and _is_record(payload_raw.get("context")):
        return dict(payload_raw["context"])
    return {}


def _extract_contract(body: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if _is_record(body.get("contract")):
        return dict(body["contract"])
    return None


def _extract_agentic(body: Dict[str, Any]) -> Dict[str, Any]:
    if _is_record(body.get("agentic")):
        return dict(body["agentic"])
    payload_raw = body.get("payload", {}).get("raw_data", {}) if _is_record(body.get("payload")) else {}
    if _is_record(payload_raw) and _is_record(payload_raw.get("_agentic")):
        return dict(payload_raw["_agentic"])
    return {}


def _resolve_missing_required_args_from_capability(
    capability: Dict[str, Any],
    args: Dict[str, Any],
) -> List[str]:
    input_schema = capability.get("input_schema") if _is_record(capability.get("input_schema")) else {}
    required = input_schema.get("required") if isinstance(input_schema.get("required"), list) else []
    normalized_required = [
        entry.strip()
        for entry in required
        if isinstance(entry, str) and entry.strip()
    ]
    missing = []
    for field in normalized_required:
        if field not in args or _is_missing_arg_value(args.get(field), field):
            missing.append(field)
    return missing


def _resolve_required_preprocessing(capability: Dict[str, Any]) -> List[str]:
    preflight = capability.get("preflight") if _is_record(capability.get("preflight")) else {}
    return _normalize_string_list(preflight.get("required_preprocessing"), lambda entry: entry.lower())


def _resolve_provided_preprocessing(body: Dict[str, Any]) -> List[str]:
    agentic = _extract_agentic(body)
    return _normalize_string_list(agentic.get("preprocessing"), lambda entry: entry.lower())


def _build_preflight_checks(
    missing_required_args: List[str],
    execution_mode: str,
    missing_preprocessing: List[str],
) -> List[Dict[str, Any]]:
    return [
        {
            "code": "INPUT_VALID",
            "status": "fail" if missing_required_args else "pass",
            "message": (
                f'Missing required argument(s): {", ".join(missing_required_args)}'
                if missing_required_args
                else "Input schema validation passed."
            ),
        },
        {
            "code": "EXECUTION_MODE",
            "status": "fail" if execution_mode == "agent_only" else "pass",
            "message": (
                "Capability execution_mode=agent_only cannot be delegated through the SDK router."
                if execution_mode == "agent_only"
                else f"Capability execution_mode={execution_mode or 'delegate_only'}."
            ),
        },
        {
            "code": "PREPROCESSING_READY",
            "status": "fail" if missing_preprocessing else "pass",
            "message": (
                f'Missing required preprocessing step(s): {", ".join(missing_preprocessing)}'
                if missing_preprocessing
                else "Preprocessing requirements satisfied."
            ),
        },
    ]


def _normalize_token(value: str = "", fallback: str = "skill") -> str:
    normalized = re.sub(r"[^a-z0-9-]+", "-", str(value or "").strip().lower())
    normalized = re.sub(r"-{2,}", "-", normalized).strip("-")
    return normalized or fallback


def _sanitize_path_segment(value: str = "", fallback: str = "unknown") -> str:
    normalized = re.sub(r"[^a-zA-Z0-9._-]+", "-", str(value or "").strip()).strip("-")
    return normalized or fallback


def _as_yaml_string(value: str = "") -> str:
    return json.dumps(str(value or ""))


def _get_local_app_agent_skills_root_dir(env: Optional[Dict[str, str]] = None) -> Path:
    active_env = env or os.environ
    override = str(active_env.get("LOCAL_APP_AGENT_SKILLS_DIR", "")).strip()
    if override:
        return Path(override).expanduser().resolve()
    return Path.home() / ".realtimex.ai" / "Resources" / "agent-skills" / "local-apps"


def _to_app_directory_name(app_id: str = "") -> str:
    candidate = str(app_id or "").strip()
    if re.match(r"^[a-zA-Z0-9._-]{1,128}$", candidate):
        return candidate
    token = _sanitize_path_segment(candidate, "local-app")
    suffix = hashlib.sha1(candidate.encode("utf-8")).hexdigest()[:8]
    return f"{token}-{suffix}"


def _build_skill_name(app_id: str, app_name: str, capability_id: str) -> str:
    app_token = _normalize_token(app_name or app_id, "local-app")
    capability_token = _normalize_token(capability_id, "capability")
    base = _normalize_token(f"{app_token}-{capability_token}", "local-app-skill")
    if len(base) <= 64:
        return base
    hashed = hashlib.sha1(f"{app_id}:{capability_id}".encode("utf-8")).hexdigest()[:8]
    return f"{base[:55].rstrip('-')}-{hashed}"[:64]


def _join_url(base_url: str, route_path: str) -> str:
    normalized_base_url = str(base_url or "").strip().rstrip("/")
    normalized_path = str(route_path or "").strip()
    if not normalized_path:
        return normalized_base_url
    if normalized_path.lower().startswith(("http://", "https://")):
        return normalized_path
    if not normalized_base_url:
        return normalized_path if normalized_path.startswith("/") else f"/{normalized_path}"
    return f"{normalized_base_url}{normalized_path if normalized_path.startswith('/') else '/' + normalized_path}"


def _build_input_summary(capability: Dict[str, Any]) -> List[Dict[str, Any]]:
    input_schema = capability.get("input_schema") if _is_record(capability.get("input_schema")) else {}
    properties = input_schema.get("properties") if _is_record(input_schema.get("properties")) else {}
    required = {
        entry.strip()
        for entry in input_schema.get("required", [])
        if isinstance(entry, str) and entry.strip()
    }
    rows = []
    for key, prop in properties.items():
        record = prop if _is_record(prop) else {}
        rows.append(
            {
                "name": key,
                "type": record.get("type", "any") if isinstance(record.get("type"), str) else "any",
                "required": key in required,
                "description": record.get("description", "").strip()
                if isinstance(record.get("description"), str)
                else "",
            }
        )
    if not rows:
        for field in required:
            rows.append({"name": field, "type": "any", "required": True, "description": ""})
    return rows


def _build_args_template(capability: Dict[str, Any]) -> Dict[str, Any]:
    input_schema = capability.get("input_schema") if _is_record(capability.get("input_schema")) else {}
    properties = input_schema.get("properties") if _is_record(input_schema.get("properties")) else {}
    required = input_schema.get("required") if isinstance(input_schema.get("required"), list) else []
    args: Dict[str, Any] = {}
    for field in required:
        if not isinstance(field, str) or not field.strip():
            continue
        key = field.strip()
        prop = properties.get(key) if _is_record(properties.get(key)) else {}
        prop_type = prop.get("type") if isinstance(prop.get("type"), str) else ""
        if prop_type in ("number", "integer"):
            args[key] = 0
        elif prop_type == "boolean":
            args[key] = False
        elif prop_type == "array":
            args[key] = []
        elif prop_type == "object":
            args[key] = {}
        else:
            args[key] = f"<{key}>"
    return args


def _format_configuration_entry(entry: Dict[str, Any]) -> str:
    flags = []
    if isinstance(entry.get("source"), str) and entry["source"].strip():
        flags.append(f"source: {entry['source'].strip()}")
    if entry.get("sensitive") is True:
        flags.append("sensitive")
    metadata = f" ({', '.join(flags)})" if flags else ""
    description = (
        f" - {entry['description'].strip()}"
        if isinstance(entry.get("description"), str) and entry["description"].strip()
        else ""
    )
    return f"- `{entry['key']}`{metadata}{description}"


def _has_runtime_context_configuration(capability: Dict[str, Any]) -> bool:
    configuration = capability.get("configuration")
    if not _is_record(configuration):
        return False
    entries = _normalize_capability_config_entries(
        list(configuration.get("required", [])) + list(configuration.get("optional", []))
    )
    return any(
        isinstance(entry.get("source"), str)
        and entry["source"].strip().lower().startswith("runtime_context.")
        for entry in entries
    )


def _build_preflight_request_body(capability: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "capability_id": capability.get("capability_id"),
        "args": _build_args_template(capability),
    }


def _build_invoke_request_body(capability: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "capability_id": capability.get("capability_id"),
        "args": _build_args_template(capability),
        "context": {
            "workspace_id": "<runtime-provided>",
            "thread_id": "<runtime-provided>",
            "user_id": "<runtime-provided>",
        },
        "contract": {
            "contract_version": LOCAL_APP_CONTRACT_VERSION,
        },
    }


def _build_skill_metadata(
    capability: Dict[str, Any],
    skill_name: str,
    app_id: str,
    app_name: str,
    router: Dict[str, Any],
) -> Dict[str, Any]:
    description = (
        capability["description"].strip()
        if isinstance(capability.get("description"), str) and capability["description"].strip()
        else f'Invoke {capability.get("name") or capability.get("capability_id") or "local app capability"}.'
    )
    return {
        "schema": "agentskills.io/v1",
        "name": skill_name,
        "description": description,
        "app_id": app_id or None,
        "app_name": app_name or None,
        "capability_id": capability.get("capability_id") or None,
        "contract_version": LOCAL_APP_CONTRACT_VERSION,
        "execution_mode": capability.get("execution_mode") or "delegate_only",
        "domain": capability.get("domain") or "custom",
        "intent_tags": capability.get("intent_tags") if isinstance(capability.get("intent_tags"), list) else [],
        "allowed_preprocessing": capability.get("allowed_preprocessing")
        if isinstance(capability.get("allowed_preprocessing"), list)
        else [],
        "allowed_side_effects": capability.get("allowed_side_effects")
        if isinstance(capability.get("allowed_side_effects"), list)
        else [],
        "network_policy": capability.get("network_policy"),
        "artifact_policy": capability.get("artifact_policy"),
        "approval_policy": capability.get("approval_policy"),
        "idempotency": capability.get("idempotency"),
        "error_codes": capability.get("error_codes") if isinstance(capability.get("error_codes"), list) else [],
        "configuration": capability.get("configuration"),
        "input_schema": capability.get("input_schema") if _is_record(capability.get("input_schema")) else None,
        "output_schema": capability.get("output_schema") if _is_record(capability.get("output_schema")) else None,
        "trigger": capability.get("trigger") if _is_record(capability.get("trigger")) else None,
        "delivery": capability.get("delivery"),
        "preflight": capability.get("preflight"),
        "permission": capability.get("permission"),
        "risk_level": capability.get("risk_level"),
        "tags": capability.get("tags") if isinstance(capability.get("tags"), list) else [],
        "examples": capability.get("examples") if isinstance(capability.get("examples"), list) else [],
        "router": router,
        "generated_at": _iso_now(),
    }


def _build_skill_markdown(capability: Dict[str, Any], metadata: Dict[str, Any]) -> str:
    capability_name = capability.get("name") or capability.get("capability_id") or "Capability"
    description = (
        capability["description"].strip()
        if isinstance(capability.get("description"), str) and capability["description"].strip()
        else f"Invoke {capability_name}."
    )
    input_summary = _build_input_summary(capability)
    examples = capability.get("examples") if isinstance(capability.get("examples"), list) else []
    required_preprocessing = _resolve_required_preprocessing(capability)

    lines = [
        "---",
        f"name: {metadata['name']}",
        f'description: {_as_yaml_string(f"{description} Use when the user asks to perform this action in {metadata.get("app_name") or metadata.get("app_id") or "the Local App"}.")}',
        f'compatibility: {_as_yaml_string("Requires HTTP access to the Local App contract router.")}',
        "metadata:",
        f'  app_id: {_as_yaml_string(metadata.get("app_id") or "")}',
        f'  app_name: {_as_yaml_string(metadata.get("app_name") or "")}',
        f'  capability_id: {_as_yaml_string(metadata.get("capability_id") or "")}',
        f'  contract_version: {_as_yaml_string(metadata["contract_version"])}',
        f'  base_url: {_as_yaml_string(metadata["router"]["base_url"])}',
        f'  preflight_url: {_as_yaml_string(metadata["router"]["preflight_url"])}',
        f'  invoke_url: {_as_yaml_string(metadata["router"]["invoke_url"])}',
        f'  health_url: {_as_yaml_string(metadata["router"]["health_url"])}',
        "---",
        "",
        f"# {capability_name}",
        "",
        f'This skill invokes `{capability.get("capability_id")}` through the Local App contract router for **{metadata.get("app_name") or metadata.get("app_id") or "the Local App"}**.',
        "",
        "## When To Use",
        "",
        f'Use this skill when the user asks to perform a task handled by {metadata.get("app_name") or metadata.get("app_id") or "the Local App"}.',
        "",
        "## Required Inputs",
        "",
    ]

    if not input_summary:
        lines.append("- No explicit required fields were declared by the app.")
    else:
        for row in input_summary:
            required_text = "required" if row["required"] else "optional"
            suffix = f' - {row["description"]}' if row["description"] else ""
            lines.append(f'- `{row["name"]}` ({row["type"]}, {required_text}){suffix}')

    configuration = capability.get("configuration")
    if _is_record(configuration):
        required_configuration = _normalize_capability_config_entries(configuration.get("required"))
        optional_configuration = _normalize_capability_config_entries(configuration.get("optional"))
        lines.extend(["", "## Configuration", "", "Resolve declared configuration requirements before invoke."])
        if required_configuration:
            lines.extend(["", "Required configuration:"])
            for entry in required_configuration:
                lines.append(_format_configuration_entry(entry))
        if optional_configuration:
            lines.extend(["", "Optional configuration:"])
            for entry in optional_configuration:
                lines.append(_format_configuration_entry(entry))
        if isinstance(configuration.get("setup_steps"), list) and configuration["setup_steps"]:
            lines.extend(["", "Setup steps:"])
            for step in configuration["setup_steps"]:
                lines.append(f"- {step}")
        if isinstance(configuration.get("notes"), list) and configuration["notes"]:
            lines.extend(["", "Configuration notes:"])
            for note in configuration["notes"]:
                lines.append(f"- {note}")
        if _has_runtime_context_configuration(capability):
            lines.extend(
                [
                    "",
                    "Values sourced from `runtime_context.*` should be resolved by the runtime or host context broker when available.",
                ]
            )

    lines.extend(
        [
            "",
            "## Preflight",
            "",
            f'1. Check router availability with `GET {metadata["router"]["health_url"]}`.',
            f'2. Run preflight with `POST {metadata["router"]["preflight_url"]}`.',
            "3. If preflight returns `PREPROCESSING_REQUIRED`, perform the listed preprocessing steps and retry preflight.",
            "4. If preflight returns `assist_then_delegate` or `delegate_now`, call invoke.",
            "",
            "### Preflight Request",
            "",
            "```json",
            json.dumps(
                {
                    "method": "POST",
                    "url": metadata["router"]["preflight_url"],
                    "headers": {"Content-Type": "application/json"},
                    "body": _build_preflight_request_body(capability),
                },
                indent=2,
            ),
            "```",
            "",
            "## Invoke",
            "",
            f'Use `POST {metadata["router"]["invoke_url"]}` after preflight succeeds.',
            "",
            "### Invoke Request",
            "",
            "```json",
            json.dumps(
                {
                    "method": "POST",
                    "url": metadata["router"]["invoke_url"],
                    "headers": {"Content-Type": "application/json"},
                    "body": _build_invoke_request_body(capability),
                },
                indent=2,
            ),
            "```",
        ]
    )

    if required_preprocessing:
        lines.extend(["", "## Preprocessing", "", "This capability declares required preprocessing before invoke:"])
        for step in required_preprocessing:
            lines.append(f"- `{step}`")

    lines.extend(
        [
            "",
            "## Constraints",
            "",
            "- Use the documented contract router routes only.",
            "- Do not call unrelated Local App endpoints directly.",
            "- Do not ask for `workspace_id`, `thread_id`, or `user_id` before first invoke if runtime context can provide them.",
            "- Never hardcode credentials or search source files, env files, or shell history for secrets.",
            "- If invoke fails with missing context or auth, then request the specific missing value.",
        ]
    )

    if examples:
        lines.extend(["", "## Example Intents", ""])
        for example in examples[:10]:
            lines.append(f"- {example}")

    return "\n".join(lines) + "\n"


def _read_app_index(file_path: Path) -> Optional[Dict[str, Any]]:
    if not file_path.exists():
        return None
    try:
        parsed = json.loads(file_path.read_text("utf-8"))
    except Exception:
        return None
    if not _is_record(parsed):
        return None
    app_id = parsed.get("app_id") if isinstance(parsed.get("app_id"), str) else ""
    app_name = parsed.get("app_name") if isinstance(parsed.get("app_name"), str) else ""
    app_dir = parsed.get("app_dir") if isinstance(parsed.get("app_dir"), str) else ""
    if not app_id or not app_name or not app_dir:
        return None
    skills = []
    for entry in parsed.get("skills", []):
        if not _is_record(entry):
            continue
        name = entry.get("name") if isinstance(entry.get("name"), str) else ""
        rel_path = entry.get("path") if isinstance(entry.get("path"), str) else ""
        capability_id = entry.get("capability_id") if isinstance(entry.get("capability_id"), str) else ""
        if not name or not rel_path or not capability_id:
            continue
        skills.append(
            {
                "name": name,
                "path": rel_path,
                "app_id": entry.get("app_id") if isinstance(entry.get("app_id"), str) else app_id,
                "capability_id": capability_id,
                "description": entry.get("description") if isinstance(entry.get("description"), str) else None,
            }
        )
    return {
        "app_id": app_id,
        "app_name": app_name,
        "app_dir": app_dir,
        "generated_at": parsed.get("generated_at") if isinstance(parsed.get("generated_at"), str) else _iso_now(),
        "count": int(parsed.get("count")) if isinstance(parsed.get("count"), int) else len(skills),
        "skills": skills,
    }


def _write_file_if_changed(file_path: Path, content: str) -> bool:
    if file_path.exists() and file_path.read_text("utf-8") == content:
        return False
    file_path.write_text(content, encoding="utf-8")
    return True


def _iso_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class ContractModule:
    """Discover, compile, execute, and publish Local App contract definitions."""

    def __init__(
        self,
        realtimex_url: str,
        app_name: Optional[str] = None,
        app_id: Optional[str] = None,
        api_key: Optional[str] = None,
    ):
        self.realtimex_url = realtimex_url.rstrip("/")
        self.app_name = app_name or os.environ.get("RTX_APP_NAME", "Local App")
        self.app_id = app_id
        self.api_key = api_key
        self._cache: Optional[Dict[str, Any]] = None
        self._cached_capabilities: Optional[List[Dict[str, Any]]] = None
        self._cached_capability_catalog_hash: Optional[str] = None
        self._local_compiled_capabilities: Optional[List[Dict[str, Any]]] = None
        self._local_compile_report: Optional[Dict[str, Any]] = None

    async def _request_permission(self, permission: str) -> bool:
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.realtimex_url}/api/local-apps/request-permission",
                    json={
                        "app_id": self.app_id,
                        "app_name": self.app_name,
                        "permission": permission,
                    },
                    timeout=60.0,
                )
                data = response.json()
                return data.get("granted", False) is True
        except Exception:
            return False

    async def _request(
        self,
        endpoint: str,
        method: str = "GET",
        json_body: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if self.app_id:
            headers["x-app-id"] = self.app_id
        if self.app_name:
            headers["x-app-name"] = self.app_name

        async with httpx.AsyncClient() as client:
            response = await client.request(
                method,
                f"{self.realtimex_url}{endpoint}",
                headers=headers,
                json=json_body,
                timeout=60.0,
            )
            try:
                data = response.json()
            except Exception:
                data = {}

            if response.status_code == 403:
                error_code = data.get("error")
                permission = data.get("permission")
                message = data.get("message")

                if error_code == "PERMISSION_REQUIRED" and permission:
                    granted = await self._request_permission(permission)
                    if granted:
                        return await self._request(endpoint, method=method, json_body=json_body)
                    raise PermissionDeniedError(permission, message)

                if error_code == "PERMISSION_DENIED":
                    raise PermissionDeniedError(permission, message)

            if not response.is_success:
                raise Exception(data.get("error") or f"Request failed: {response.status_code}")
            return data

    async def get_local_app_v1(self, force_refresh: bool = False) -> Dict[str, Any]:
        if self._cache and not force_refresh:
            return self._cache
        data = await self._request("/contracts/local-app/v1")
        self._cache = data.get("contract", {})
        if isinstance(self._cache.get("capabilities"), list):
            self._cached_capabilities = self._cache["capabilities"]
            self._cached_capability_catalog_hash = self._cache.get("catalog_hash")
        return self._cache

    async def list_capabilities(self, force_refresh: bool = False) -> List[Dict[str, Any]]:
        if self._cached_capabilities is not None and not force_refresh:
            return self._cached_capabilities
        data = await self._request("/contracts/local-app/v1/capabilities")
        self._cached_capabilities = data.get("capabilities") if isinstance(data.get("capabilities"), list) else []
        self._cached_capability_catalog_hash = data.get("catalog_hash")
        return self._cached_capabilities

    async def search_capabilities(self, query: str) -> List[Dict[str, Any]]:
        normalized_query = str(query or "").strip()
        if not normalized_query:
            raise ValueError("search_capabilities requires a non-empty query")
        data = await self._request(
            f"/contracts/local-app/v1/capabilities/search?q={quote(normalized_query)}"
        )
        return data.get("capabilities") if isinstance(data.get("capabilities"), list) else []

    async def describe_capability(self, capability_id: str) -> Dict[str, Any]:
        normalized_capability_id = str(capability_id or "").strip()
        if not normalized_capability_id:
            raise ValueError("describe_capability requires a non-empty capability id")
        data = await self._request(
            f"/contracts/local-app/v1/capabilities/{quote(normalized_capability_id)}"
        )
        return data.get("capability", {})

    async def search(self, query: str) -> List[Dict[str, Any]]:
        return await self.search_capabilities(query)

    async def describe(self, capability_id: str) -> Dict[str, Any]:
        return await self.describe_capability(capability_id)

    def compile_capabilities(
        self,
        capabilities: Optional[List[Dict[str, Any]]] = None,
        strict: bool = False,
        default_trigger_route: str = DEFAULT_CONTRACT_TRIGGER_ROUTE,
    ) -> Dict[str, Any]:
        return compile_capabilities(
            capabilities=capabilities,
            strict=strict,
            default_trigger_route=default_trigger_route,
        )

    def set_local_capability_manifest(
        self,
        capabilities: Optional[List[Dict[str, Any]]] = None,
        strict: bool = False,
        default_trigger_route: str = DEFAULT_CONTRACT_TRIGGER_ROUTE,
    ) -> Dict[str, Any]:
        report = compile_capabilities(
            capabilities=capabilities,
            strict=strict,
            default_trigger_route=default_trigger_route,
        )
        self._local_compile_report = report
        self._local_compiled_capabilities = report.get("capabilities", [])
        return report

    def get_compiled_capabilities(self) -> List[Dict[str, Any]]:
        return list(self._local_compiled_capabilities or [])

    def get_capability_compile_report(self) -> Optional[Dict[str, Any]]:
        return self._local_compile_report

    async def sync_local_capabilities(
        self,
        capabilities: Optional[List[Dict[str, Any]]] = None,
        strict: bool = False,
        contract_version: str = LOCAL_APP_CONTRACT_VERSION,
    ) -> Dict[str, Any]:
        report = (
            self.set_local_capability_manifest(capabilities=capabilities, strict=strict)
            if isinstance(capabilities, list)
            else self._local_compile_report
        )
        if not report or not isinstance(report.get("capabilities"), list):
            raise ValueError(
                "No compiled capabilities available to sync. Provide capabilities or call set_local_capability_manifest first."
            )
        return await self._request(
            "/sdk/local-apps/contract-capabilities",
            method="POST",
            json_body={
                "contract_version": contract_version or LOCAL_APP_CONTRACT_VERSION,
                "capabilities": report["capabilities"],
                "migration_report": {
                    "input_count": report.get("input_count", 0),
                    "output_count": report.get("output_count", 0),
                    "migrated_count": report.get("migrated_count", 0),
                    "dropped_count": report.get("dropped_count", 0),
                    "warning_count": len(report.get("warnings", [])),
                },
            },
        )

    def _resolve_invoke_capabilities(self, options: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        safe_options = options if _is_record(options) else {}
        if isinstance(safe_options.get("capabilities"), list):
            return compile_capabilities(safe_options["capabilities"]).get("capabilities", [])
        if isinstance(self._local_compiled_capabilities, list):
            return self._local_compiled_capabilities
        return []

    async def handle_preflight_request(
        self,
        body: Optional[Dict[str, Any]] = None,
        options: Optional[Dict[str, Any]] = None,
        request: Any = None,
    ) -> Dict[str, Any]:
        safe_body = body if _is_record(body) else {}
        capability_id = _extract_capability_id(safe_body)
        if not capability_id:
            return {
                "status": 400,
                "payload": {
                    "success": False,
                    "capability_id": "",
                    "decision": "blocked",
                    "next_action": "provide_capability_id",
                    "checks": [],
                    "blocking_codes": ["INPUT_INVALID"],
                    "code": "INPUT_INVALID",
                    "error": "Missing required field: capability_id",
                },
            }

        resolved_capabilities = self._resolve_invoke_capabilities(options)
        capability = next(
            (entry for entry in resolved_capabilities if entry.get("capability_id") == capability_id),
            None,
        )
        if not capability and resolved_capabilities:
            return {
                "status": 404,
                "payload": {
                    "success": False,
                    "capability_id": capability_id,
                    "decision": "blocked",
                    "next_action": "select_valid_capability",
                    "checks": [],
                    "blocking_codes": ["CAPABILITY_NOT_FOUND"],
                    "code": "CAPABILITY_NOT_FOUND",
                    "error": f"Capability not found in manifest: {capability_id}",
                },
            }

        if not capability:
            capability = {
                "capability_id": capability_id,
                "name": capability_id,
                "input_schema": {"type": "object", "additionalProperties": True},
                "enabled": True,
            }

        if capability.get("enabled") is False:
            return {
                "status": 403,
                "payload": {
                    "success": False,
                    "capability_id": capability_id,
                    "decision": "blocked",
                    "next_action": "select_valid_capability",
                    "checks": [],
                    "blocking_codes": ["CAPABILITY_DISABLED"],
                    "code": "CAPABILITY_DISABLED",
                    "error": f"Capability is disabled: {capability_id}",
                },
            }

        args = _extract_args(safe_body)
        missing_required_args = _resolve_missing_required_args_from_capability(capability, args)
        execution_mode = capability.get("execution_mode") or "delegate_only"
        required_preprocessing = _resolve_required_preprocessing(capability)
        provided_preprocessing = _resolve_provided_preprocessing(safe_body)
        missing_preprocessing = [
            entry for entry in required_preprocessing if entry not in provided_preprocessing
        ]
        checks = _build_preflight_checks(
            missing_required_args=missing_required_args,
            execution_mode=execution_mode,
            missing_preprocessing=missing_preprocessing,
        )

        if missing_required_args:
            return {
                "status": 400,
                "payload": {
                    "success": False,
                    "capability_id": capability_id,
                    "decision": "blocked",
                    "next_action": "collect_required_args",
                    "execution_mode": execution_mode,
                    "checks": checks,
                    "required_preprocessing": required_preprocessing,
                    "blocking_codes": ["INPUT_INVALID"],
                    "code": "INPUT_INVALID",
                    "error": f'Missing required argument(s): {", ".join(missing_required_args)}',
                    "missing_required_args": missing_required_args,
                },
            }

        if execution_mode == "agent_only":
            return {
                "status": 409,
                "payload": {
                    "success": False,
                    "capability_id": capability_id,
                    "decision": "blocked",
                    "next_action": "agent_execute_without_delegate",
                    "execution_mode": execution_mode,
                    "checks": checks,
                    "required_preprocessing": required_preprocessing,
                    "blocking_codes": ["EXECUTION_MODE_AGENT_ONLY"],
                    "code": "EXECUTION_MODE_AGENT_ONLY",
                    "error": "Capability execution_mode=agent_only cannot be delegated through the SDK router.",
                },
            }

        if missing_preprocessing:
            return {
                "status": 409,
                "payload": {
                    "success": False,
                    "capability_id": capability_id,
                    "decision": "blocked",
                    "next_action": "perform_preprocessing_then_invoke",
                    "execution_mode": execution_mode,
                    "checks": checks,
                    "required_preprocessing": missing_preprocessing,
                    "blocking_codes": ["PREPROCESSING_REQUIRED"],
                    "code": "PREPROCESSING_REQUIRED",
                    "error": f'Missing required preprocessing step(s): {", ".join(missing_preprocessing)}',
                },
            }

        return {
            "status": 200,
            "payload": {
                "success": True,
                "capability_id": capability_id,
                "decision": "assist_then_delegate" if execution_mode == "assist_then_delegate" else "delegate_now",
                "next_action": "invoke",
                "execution_mode": execution_mode,
                "checks": checks,
                "required_preprocessing": [],
            },
        }

    async def handle_health_request(
        self,
        options: Optional[Dict[str, Any]] = None,
        request: Any = None,
    ) -> Dict[str, Any]:
        resolved_capabilities = self._resolve_invoke_capabilities(options)
        return {
            "status": 200,
            "payload": {
                "success": True,
                "status": "ok",
                "contract_version": LOCAL_APP_CONTRACT_VERSION,
                "app_id": self.app_id,
                "app_name": self.app_name,
                "capability_count": len(resolved_capabilities),
            },
        }

    async def handle_invoke_request(
        self,
        body: Optional[Dict[str, Any]],
        options: Dict[str, Any],
        request: Any = None,
    ) -> Dict[str, Any]:
        safe_body = body if _is_record(body) else {}
        capability_id = _extract_capability_id(safe_body)
        if not capability_id:
            return {
                "status": 400,
                "payload": {
                    "success": False,
                    "capability_id": "",
                    "code": "INPUT_INVALID",
                    "error": "Missing required field: capability_id",
                },
            }

        handlers = options.get("handlers") if _is_record(options) else None
        handler = handlers.get(capability_id) if _is_record(handlers) else None
        if not callable(handler):
            return {
                "status": 404,
                "payload": {
                    "success": False,
                    "capability_id": capability_id,
                    "code": "CAPABILITY_NOT_SUPPORTED",
                    "error": f"No capability handler registered for {capability_id}",
                },
            }

        resolved_capabilities = self._resolve_invoke_capabilities(options)
        capability = next(
            (entry for entry in resolved_capabilities if entry.get("capability_id") == capability_id),
            None,
        )
        if not capability and resolved_capabilities:
            return {
                "status": 404,
                "payload": {
                    "success": False,
                    "capability_id": capability_id,
                    "code": "CAPABILITY_NOT_FOUND",
                    "error": f"Capability not found in manifest: {capability_id}",
                },
            }

        if not capability:
            capability = {
                "capability_id": capability_id,
                "name": capability_id,
                "input_schema": {"type": "object", "additionalProperties": True},
                "enabled": True,
            }

        if capability.get("enabled") is False:
            return {
                "status": 403,
                "payload": {
                    "success": False,
                    "capability_id": capability_id,
                    "code": "CAPABILITY_DISABLED",
                    "error": f"Capability is disabled: {capability_id}",
                },
            }

        args = _extract_args(safe_body)
        context = _extract_context(safe_body)
        contract = _extract_contract(safe_body)
        missing_required_args = _resolve_missing_required_args_from_capability(capability, args)
        if missing_required_args:
            return {
                "status": 400,
                "payload": {
                    "success": False,
                    "capability_id": capability_id,
                    "code": "INPUT_INVALID",
                    "error": f'Missing required argument(s): {", ".join(missing_required_args)}',
                    "missing_required_args": missing_required_args,
                },
            }

        try:
            handler_input = {
                "capability_id": capability_id,
                "args": args,
                "context": context,
                "contract": contract,
                "capability": capability,
                "request_body": safe_body,
                "request": request,
            }
            result = handler(handler_input)
            if inspect.isawaitable(result):
                result = await result
            safe_result = result if _is_record(result) else {}

            if safe_result.get("success") is False:
                status = int(safe_result.get("status")) if isinstance(safe_result.get("status"), int) else 400
                payload = {
                    "success": False,
                    "capability_id": capability_id,
                    "code": safe_result.get("code") if isinstance(safe_result.get("code"), str) and safe_result.get("code") else "EXECUTION_FAILED",
                    "error": safe_result.get("error") if isinstance(safe_result.get("error"), str) and safe_result.get("error") else "Capability handler returned an error response.",
                }
                payload.update(safe_result)
                return {"status": status, "payload": payload}

            success_payload = {"success": True, "capability_id": capability_id}
            success_payload.update(safe_result)
            if not success_payload.get("task_uuid") and success_payload.get("task_id"):
                success_payload["task_uuid"] = str(success_payload["task_id"])
            if not success_payload.get("task_id") and success_payload.get("task_uuid"):
                success_payload["task_id"] = str(success_payload["task_uuid"])
            return {"status": 200, "payload": success_payload}
        except Exception as error:
            status = getattr(error, "status", None) or getattr(error, "statusCode", None) or 500
            try:
                status = int(status)
            except Exception:
                status = 500
            code = getattr(error, "code", None)
            return {
                "status": status if status > 0 else 500,
                "payload": {
                    "success": False,
                    "capability_id": capability_id,
                    "code": code if isinstance(code, str) and code.strip() else "EXECUTION_FAILED",
                    "error": str(error) or "Capability handler execution failed",
                },
            }

    def create_preflight_handler(self, options: Optional[Dict[str, Any]] = None):
        async def handler(body: Optional[Dict[str, Any]] = None, request: Any = None) -> Dict[str, Any]:
            return await self.handle_preflight_request(body, options or {}, request)

        return handler

    def create_invoke_handler(self, options: Dict[str, Any]):
        if not _is_record(options) or not _is_record(options.get("handlers")):
            raise ValueError("create_invoke_handler requires options.handlers")

        async def handler(body: Optional[Dict[str, Any]] = None, request: Any = None) -> Dict[str, Any]:
            return await self.handle_invoke_request(body, options, request)

        return handler

    def create_health_handler(self, options: Optional[Dict[str, Any]] = None):
        async def handler(request: Any = None) -> Dict[str, Any]:
            return await self.handle_health_request(options or {}, request)

        return handler

    def create_contract_router(self, options: Dict[str, Any]) -> Dict[str, Any]:
        if not _is_record(options) or not _is_record(options.get("handlers")):
            raise ValueError("create_contract_router requires options.handlers")

        return {
            "preflight": self.create_preflight_handler(options),
            "invoke": self.create_invoke_handler(options),
            "health": self.create_health_handler(options),
            "handle_preflight_request": self.create_preflight_handler(options),
            "handle_invoke_request": self.create_invoke_handler(options),
            "handle_health_request": self.create_health_handler(options),
        }

    def build_skill_artifacts(
        self,
        capabilities: Optional[List[Dict[str, Any]]] = None,
        strict: bool = False,
        root_dir: Optional[str] = None,
        cleanup_stale_skills: bool = True,
        base_url: Optional[str] = None,
        preflight_path: Optional[str] = None,
        invoke_path: Optional[str] = None,
        health_path: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        app_id = str(self.app_id or "").strip()
        if not app_id:
            raise ValueError("build_skill_artifacts requires app_id on the ContractModule instance")

        app_name = str(self.app_name or app_id).strip() or app_id
        report = (
            self.set_local_capability_manifest(capabilities=capabilities, strict=strict)
            if isinstance(capabilities, list)
            else self._local_compile_report
        )
        if not report or not isinstance(report.get("capabilities"), list):
            raise ValueError(
                "No compiled capabilities available to publish. Provide capabilities or call set_local_capability_manifest first."
            )

        active_env = env or dict(os.environ)
        resolved_root_dir = Path(root_dir).expanduser().resolve() if root_dir else _get_local_app_agent_skills_root_dir(active_env)
        app_dir = _to_app_directory_name(app_id)
        app_dir_path = resolved_root_dir / app_dir
        resolved_base_url = (
            str(
                base_url
                or active_env.get("RTX_LOCAL_APP_BASE_URL")
                or active_env.get("LOCAL_APP_BASE_URL")
                or ""
            ).strip()
            or DEFAULT_SKILL_BASE_URL
        )
        resolved_preflight_path = (preflight_path or DEFAULT_SKILL_PREFLIGHT_PATH).strip() or DEFAULT_SKILL_PREFLIGHT_PATH
        resolved_health_path = (health_path or DEFAULT_SKILL_HEALTH_PATH).strip() or DEFAULT_SKILL_HEALTH_PATH

        artifacts = []
        for capability in report["capabilities"]:
            if capability.get("enabled") is False:
                continue
            capability_invoke_path = (
                invoke_path
                or (
                    capability.get("delivery", {}).get("api", {}).get("path")
                    if _is_record(capability.get("delivery"))
                    and capability.get("delivery", {}).get("mode") == "api"
                    and isinstance(capability.get("delivery", {}).get("api", {}).get("path"), str)
                    else ""
                )
                or DEFAULT_SKILL_INVOKE_PATH
            )
            router = {
                "base_url": resolved_base_url,
                "preflight_path": resolved_preflight_path,
                "invoke_path": capability_invoke_path,
                "health_path": resolved_health_path,
                "preflight_url": _join_url(resolved_base_url, resolved_preflight_path),
                "invoke_url": _join_url(resolved_base_url, capability_invoke_path),
                "health_url": _join_url(resolved_base_url, resolved_health_path),
            }
            skill_name = _build_skill_name(app_id, app_name, capability["capability_id"])
            skill_dir = app_dir_path / skill_name
            metadata = _build_skill_metadata(capability, skill_name, app_id, app_name, router)
            artifacts.append(
                {
                    "name": skill_name,
                    "app_id": app_id,
                    "app_name": app_name,
                    "capability_id": capability["capability_id"],
                    "app_dir": app_dir,
                    "skill_dir": str(skill_dir),
                    "markdown_path": str(skill_dir / SKILL_FILE),
                    "metadata_path": str(skill_dir / SKILL_METADATA_FILE),
                    "markdown": _build_skill_markdown(capability, metadata),
                    "metadata": metadata,
                }
            )

        app_index = {
            "app_id": app_id,
            "app_name": app_name,
            "app_dir": app_dir,
            "generated_at": _iso_now(),
            "count": len(artifacts),
            "skills": [
                {
                    "name": artifact["name"],
                    "path": str(Path(app_dir) / artifact["name"] / SKILL_FILE).replace(os.sep, "/"),
                    "app_id": artifact["app_id"],
                    "capability_id": artifact["capability_id"],
                    "description": artifact["metadata"]["description"],
                }
                for artifact in artifacts
            ],
        }

        return {
            "root_dir": str(resolved_root_dir),
            "app_id": app_id,
            "app_name": app_name,
            "app_dir": app_dir,
            "artifacts": artifacts,
            "app_index": app_index,
            "cleanup_stale_skills": cleanup_stale_skills,
        }

    def publish_skills(
        self,
        capabilities: Optional[List[Dict[str, Any]]] = None,
        strict: bool = False,
        root_dir: Optional[str] = None,
        cleanup_stale_skills: bool = True,
        base_url: Optional[str] = None,
        preflight_path: Optional[str] = None,
        invoke_path: Optional[str] = None,
        health_path: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        build_result = self.build_skill_artifacts(
            capabilities=capabilities,
            strict=strict,
            root_dir=root_dir,
            cleanup_stale_skills=cleanup_stale_skills,
            base_url=base_url,
            preflight_path=preflight_path,
            invoke_path=invoke_path,
            health_path=health_path,
            env=env,
        )
        resolved_root_dir = Path(build_result["root_dir"])
        app_dir_path = resolved_root_dir / build_result["app_dir"]
        resolved_root_dir.mkdir(parents=True, exist_ok=True)
        app_dir_path.mkdir(parents=True, exist_ok=True)

        files_written = 0
        removed_dirs = 0
        desired_skill_dirs = set()

        for artifact in build_result["artifacts"]:
            skill_dir = Path(artifact["skill_dir"])
            skill_dir.mkdir(parents=True, exist_ok=True)
            desired_skill_dirs.add(artifact["name"])
            if _write_file_if_changed(Path(artifact["markdown_path"]), artifact["markdown"]):
                files_written += 1
            if _write_file_if_changed(
                Path(artifact["metadata_path"]),
                json.dumps(artifact["metadata"], indent=2) + "\n",
            ):
                files_written += 1

        if cleanup_stale_skills:
            for existing_dir in app_dir_path.iterdir():
                if not existing_dir.is_dir():
                    continue
                if existing_dir.name in desired_skill_dirs:
                    continue
                shutil.rmtree(existing_dir, ignore_errors=True)
                removed_dirs += 1

        app_index_path = app_dir_path / INDEX_FILE
        if build_result["artifacts"]:
            if _write_file_if_changed(app_index_path, json.dumps(build_result["app_index"], indent=2) + "\n"):
                files_written += 1
        elif app_index_path.exists():
            app_index_path.unlink()

        root_apps = []
        for child in resolved_root_dir.iterdir():
            if not child.is_dir():
                continue
            index = _read_app_index(child / INDEX_FILE)
            if not index or index.get("count", 0) <= 0:
                continue
            root_apps.append(
                {
                    "app_id": index["app_id"],
                    "app_name": index["app_name"],
                    "app_dir": index["app_dir"],
                    "count": index["count"],
                }
            )
        root_apps.sort(key=lambda entry: entry["app_name"])

        root_index = {
            "schema": "agentskills.io/catalog-v1",
            "generated_at": _iso_now(),
            "root_dir": str(resolved_root_dir),
            "apps": root_apps,
        }
        if _write_file_if_changed(resolved_root_dir / INDEX_FILE, json.dumps(root_index, indent=2) + "\n"):
            files_written += 1

        return {
            "success": True,
            "root_dir": build_result["root_dir"],
            "app_id": build_result["app_id"],
            "app_name": build_result["app_name"],
            "app_dir": build_result["app_dir"],
            "artifacts": build_result["artifacts"],
            "app_index": build_result["app_index"],
            "files_written": files_written,
            "removed_dirs": removed_dirs,
            "root_index": root_index,
        }

    async def invoke(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        capability_id = str(payload.get("capability_id", "")).strip()
        if not capability_id:
            raise ValueError("invoke requires payload.capability_id")
        if payload.get("auto_run") and (not payload.get("agent_name") or not payload.get("workspace_slug")):
            raise ValueError("auto_run requires agent_name and workspace_slug")

        args = dict(payload.get("args", {})) if _is_record(payload.get("args")) else {}
        if "capability" not in args:
            args["capability"] = capability_id

        return await self._request(
            "/webhooks/realtimex",
            method="POST",
            json_body={
                "app_name": self.app_name,
                "app_id": self.app_id,
                "event": "task.trigger",
                "event_id": payload.get("event_id") or create_contract_event_id(),
                "attempt_id": normalize_attempt_id(payload.get("attempt_id")),
                "payload": {
                    "raw_data": args,
                    "auto_run": payload.get("auto_run", False),
                    "agent_name": payload.get("agent_name"),
                    "workspace_slug": payload.get("workspace_slug"),
                    "thread_slug": payload.get("thread_slug"),
                    "prompt": payload.get("prompt", ""),
                },
            },
        )

    def get_cached_catalog_hash(self) -> Optional[str]:
        return self._cached_capability_catalog_hash

    def clear_cache(self) -> None:
        self._cache = None
        self._cached_capabilities = None
        self._cached_capability_catalog_hash = None
        self._local_compiled_capabilities = None
        self._local_compile_report = None
