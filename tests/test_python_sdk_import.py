def test_python_sdk_imports() -> None:
    import realtimex_sdk as sdk

    assert hasattr(sdk, "RealtimeXSDK")
    assert hasattr(sdk, "ApiModule")
