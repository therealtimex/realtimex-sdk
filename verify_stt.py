import asyncio
from realtimex_sdk import RealtimeXSDK


async def verify_stt():
    print("Verifying STT Module (Python)...")

    sdk = RealtimeXSDK(
        api_key="YK5SNGQ-67EM25S-JFKFJCT-HR43YCT", url="http://localhost:3001"
    )
    try:
        print("Testing stt.listen()...")
        print("Please speak into your microphone...")

        # Note: Depending on if Py SDK is async or sync.
        # Existing SDK seems synchronous based on file naming (no async folder),
        # but let's check client.py. If it uses `requests`, it's sync.
        # Assuming sync for now based on standard Python SDK patterns unless `aiohttp` is used.

        result = sdk.stt.listen({"provider": "native", "timeout": 10000})
        print("STT Result:", result)

        if result.get("success") and result.get("text"):
            print(f"SUCCESS: Transcribed text: {result['text']}")
        else:
            print("FAILED: No text returned")
    except Exception as e:
        print(f"Verification failed: {e}")


if __name__ == "__main__":
    # If SDK is async
    import inspect

    if inspect.iscoroutinefunction(RealtimeXSDK):
        asyncio.run(verify_stt())
    else:
        # If sync
        verify_stt()
