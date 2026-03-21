import asyncio

from realtimex_sdk import RealtimeXSDK, SDKConfig
from realtimex_sdk.contract import ContractModule


def test_sdk_auto_configures_contract_manifest_and_publish(monkeypatch, tmp_path):
    published_calls = []

    def fake_publish_skills(self, **kwargs):
        published_calls.append(kwargs)
        return {"artifacts": [{}]}

    monkeypatch.setattr(ContractModule, "publish_skills", fake_publish_skills)

    sdk = RealtimeXSDK(
        config=SDKConfig(
            app_id="app-1",
            app_name="Folio",
            contract_capabilities=[
                {
                    "capability_id": "folio.documents.add",
                    "name": "Add Document",
                    "input_schema": {"type": "object", "required": ["file_path"]},
                }
            ],
            contract_auto_sync_capabilities=False,
            contract_auto_publish_skills=True,
            contract_skill_root_dir=str(tmp_path),
            contract_skill_base_url="http://127.0.0.1:5180",
        )
    )

    assert len(sdk.contract.get_compiled_capabilities()) == 1
    assert published_calls == [
        {
            "root_dir": str(tmp_path),
            "base_url": "http://127.0.0.1:5180",
            "preflight_path": None,
            "invoke_path": None,
            "health_path": None,
            "cleanup_stale_skills": True,
        }
    ]


def test_sdk_auto_syncs_contract_capabilities(monkeypatch):
    sync_calls = []
    scheduled = []

    async def fake_sync_local_capabilities(self):
        sync_calls.append(self.get_compiled_capabilities())
        return {"success": True, "capability_count": len(self.get_compiled_capabilities())}

    def fake_schedule(self, coroutine, error_prefix):
        scheduled.append(error_prefix)
        asyncio.run(coroutine)

    monkeypatch.setattr(ContractModule, "sync_local_capabilities", fake_sync_local_capabilities)
    monkeypatch.setattr(RealtimeXSDK, "_schedule_background_coroutine", fake_schedule)

    RealtimeXSDK(
        config=SDKConfig(
            app_id="app-1",
            app_name="Folio",
            api_key="sk-test",
            contract_capabilities=[
                {
                    "capability_id": "folio.documents.add",
                    "name": "Add Document",
                    "input_schema": {"type": "object", "required": ["file_path"]},
                }
            ],
        )
    )

    assert scheduled == ["Capability sync skipped"]
    assert len(sync_calls) == 1
    assert sync_calls[0][0]["capability_id"] == "folio.documents.add"
