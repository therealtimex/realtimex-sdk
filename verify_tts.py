import asyncio
import os
from realtimex_sdk import RealtimeXSDK, SDKConfig

async def verify_tts():
    print("Verifying TTS Module (Python)...")
    
    # Initialize SDK
    config = SDKConfig(
        api_key="test-api-key",
        url="http://localhost:3001"
    )
    sdk = RealtimeXSDK(config)
    
    try:
        # 1. Test speak (buffer)
        print("Testing speak (buffer)...")
        audio_bytes = await sdk.tts.speak("Hello from RealtimeX Python SDK verification script.")
        
        if audio_bytes and len(audio_bytes) > 0:
            print(f"Success! Received bytes of size: {len(audio_bytes)}")
            with open("test_output_py.mp3", "wb") as f:
                f.write(audio_bytes)
            print("Saved to test_output_py.mp3")
        else:
            print("Failed: Received empty bytes")
            
        # 2. Test speak_stream (stream)
        print("Testing speak_stream (stream)...")
        total_bytes = 0
        with open("test_output_stream_py.mp3", "wb") as f:
            async for chunk in sdk.tts.speak_stream("This is a streaming test from RealtimeX Python SDK."):
                total_bytes += len(chunk)
                f.write(chunk)
                
        print(f"Success! Streamed total bytes: {total_bytes}")
        print("Saved to test_output_stream_py.mp3")
        
        # 3. Test list_providers
        print("Testing list_providers...")
        providers = await sdk.tts.list_providers()
        print(f"Providers: {providers}")
        
    except Exception as e:
        print(f"Verification failed: {e}")

if __name__ == "__main__":
    asyncio.run(verify_tts())
