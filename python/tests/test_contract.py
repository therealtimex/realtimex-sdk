import asyncio
import json
from pathlib import Path

from realtimex_sdk.contract import ContractModule, compile_capabilities


def test_compile_capabilities_migrates_legacy_fields():
    report = compile_capabilities(
        [
            {
                "capabilityId": "folio.documents.add",
                "name": "Add Document",
                "description": "Queue a document.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "file_path": {"type": "string"},
                    },
                    "required": ["file_path"],
                },
                "executionMode": "assist_then_delegate",
                "intentTags": ["Documents", "Ingestion"],
                "riskLevel": "LOW",
                "trigger": {"event": "trigger-agent"},
                "deliveryMode": "api",
                "deliveryApi": {
                    "method": "post",
                    "path": "/api/contracts/invoke",
                },
                "preflight": {
                    "requiredPreprocessing": ["OCR_PDF"],
                },
                "configRequirements": {
                    "requiredFields": [
                        {
                            "key": "folio_runtime_token",
                            "description": "Token used by Folio invoke runtime.",
                            "source": "runtime_context.supabase.access_token",
                            "sensitive": True,
                        }
                    ],
                    "optional": ["default_workspace_id"],
                    "setupSteps": ["Open Folio and authenticate."],
                    "notes": ["Refresh token before expiry."],
                },
            }
        ]
    )

    assert report["output_count"] == 1
    assert report["migrated_count"] == 1
    assert any(entry["code"] == "INVALID_TRIGGER_EVENT" for entry in report["warnings"])
    assert report["capabilities"][0]["execution_mode"] == "assist_then_delegate"
    assert report["capabilities"][0]["intent_tags"] == ["documents", "ingestion"]
    assert report["capabilities"][0]["risk_level"] == "low"
    assert report["capabilities"][0]["delivery"]["api"]["method"] == "POST"
    assert report["capabilities"][0]["preflight"] == {
        "required_preprocessing": ["ocr_pdf"]
    }


def test_handle_preflight_and_invoke_request():
    module = ContractModule("http://localhost:3001", "Folio", "app-1")
    module.set_local_capability_manifest(
        [
            {
                "capability_id": "folio.documents.add",
                "name": "Add Document",
                "input_schema": {
                    "type": "object",
                    "required": ["file_path"],
                },
                "execution_mode": "assist_then_delegate",
                "preflight": {
                    "required_preprocessing": ["ocr_pdf"],
                },
            }
        ]
    )

    missing = asyncio.run(
        module.handle_preflight_request(
            {"capability_id": "folio.documents.add", "args": {}},
            {"capabilities": module.get_compiled_capabilities()},
        )
    )
    assert missing["status"] == 400
    assert missing["payload"]["code"] == "INPUT_INVALID"

    blocked = asyncio.run(
        module.handle_preflight_request(
            {
                "capability_id": "folio.documents.add",
                "args": {"file_path": "/tmp/doc.pdf"},
            },
            {"capabilities": module.get_compiled_capabilities()},
        )
    )
    assert blocked["status"] == 409
    assert blocked["payload"]["code"] == "PREPROCESSING_REQUIRED"

    allowed = asyncio.run(
        module.handle_preflight_request(
            {
                "capability_id": "folio.documents.add",
                "args": {"file_path": "/tmp/doc.pdf"},
                "agentic": {"preprocessing": ["ocr_pdf"]},
            },
            {"capabilities": module.get_compiled_capabilities()},
        )
    )
    assert allowed["status"] == 200
    assert allowed["payload"]["decision"] == "assist_then_delegate"

    invoked = asyncio.run(
        module.handle_invoke_request(
            {
                "capability_id": "folio.documents.add",
                "args": {"file_path": "/tmp/doc.pdf"},
                "context": {"workspace_id": "ws-1"},
            },
            {
                "handlers": {
                    "folio.documents.add": lambda payload: {
                        "task_id": "task-1",
                        "status": "queued",
                        "workspace_id": payload["context"]["workspace_id"],
                    }
                },
                "capabilities": module.get_compiled_capabilities(),
            },
        )
    )
    assert invoked["status"] == 200
    assert invoked["payload"]["task_uuid"] == "task-1"
    assert invoked["payload"]["workspace_id"] == "ws-1"


def test_build_skill_artifacts_emits_direct_local_app_router_instructions(tmp_path: Path):
    module = ContractModule("http://localhost:3001", "Folio", "app-1")
    module.set_local_capability_manifest(
        [
            {
                "capability_id": "folio.documents.add",
                "name": "Add Document",
                "description": "Queue a document for ingestion.",
                "input_schema": {
                    "type": "object",
                    "required": ["file_path"],
                    "properties": {
                        "file_path": {
                            "type": "string",
                            "description": "Absolute path to the document.",
                        }
                    },
                },
                "execution_mode": "assist_then_delegate",
                "preflight": {"required_preprocessing": ["ocr_pdf"]},
                "delivery": {
                    "mode": "api",
                    "api": {"method": "POST", "path": "/api/contracts/invoke"},
                },
            }
        ]
    )

    result = module.build_skill_artifacts(
        root_dir=str(tmp_path),
        base_url="http://127.0.0.1:5180",
    )

    assert len(result["artifacts"]) == 1
    assert result["artifacts"][0]["metadata"]["router"]["preflight_url"] == (
        "http://127.0.0.1:5180/api/contracts/preflight"
    )
    assert "POST http://127.0.0.1:5180/api/contracts/preflight" in result["artifacts"][0]["markdown"]
    assert "POST http://127.0.0.1:5180/api/contracts/invoke" in result["artifacts"][0]["markdown"]
    assert "contracts.delegate" not in result["artifacts"][0]["markdown"]


def test_publish_skills_writes_app_artifacts_and_preserves_other_apps(tmp_path: Path):
    other_app_dir = tmp_path / "other-app"
    other_app_dir.mkdir(parents=True, exist_ok=True)
    (other_app_dir / "index.json").write_text(
        json.dumps(
            {
                "app_id": "other-app",
                "app_name": "Other App",
                "app_dir": "other-app",
                "generated_at": "2026-03-09T00:00:00.000Z",
                "count": 1,
                "skills": [
                    {
                        "name": "other-app-ping",
                        "path": "other-app/other-app-ping/SKILL.md",
                        "app_id": "other-app",
                        "capability_id": "other.ping",
                        "description": "Ping",
                    }
                ],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    module = ContractModule("http://localhost:3001", "Folio", "app-1")
    module.set_local_capability_manifest(
        [
            {
                "capability_id": "folio.documents.add",
                "name": "Add Document",
                "input_schema": {
                    "type": "object",
                    "required": ["file_path"],
                    "properties": {"file_path": {"type": "string"}},
                },
                "delivery": {
                    "mode": "api",
                    "api": {"path": "/api/contracts/invoke"},
                },
            }
        ]
    )

    stale_dir = tmp_path / "app-1" / "stale-skill"
    stale_dir.mkdir(parents=True, exist_ok=True)
    (stale_dir / "SKILL.md").write_text("# stale\n", encoding="utf-8")

    result = module.publish_skills(
        root_dir=str(tmp_path),
        base_url="http://127.0.0.1:5180",
    )

    assert result["success"] is True
    assert result["files_written"] > 0
    assert result["removed_dirs"] == 1

    skill_dir = tmp_path / "app-1" / "folio-folio-documents-add"
    assert (skill_dir / "SKILL.md").exists()
    assert (skill_dir / "skill.json").exists()
    assert (tmp_path / "app-1" / "index.json").exists()
    assert (tmp_path / "index.json").exists()
    assert not stale_dir.exists()

    root_index = json.loads((tmp_path / "index.json").read_text("utf-8"))
    app_ids = sorted(entry["app_id"] for entry in root_index["apps"])
    assert app_ids == ["app-1", "other-app"]
