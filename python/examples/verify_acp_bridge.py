#!/usr/bin/env python3
"""
ACP Bridge Verification Script (Python)

Exercises the full ACP bridge flow against a live RealTimeX server:
  1. List available CLI agents
  2. Create a session (with approvalPolicy for sync chat)
  3. Get session status
  4. Sync chat turn
  5. Streaming chat turn (SSE)
  6. Patch runtime options
  7. Close session

Usage:
  RTX_API_KEY=<key> python examples/verify_acp_bridge.py [agent_id] [cwd]
"""

import asyncio
import os
import sys

# Add parent to path for local dev
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from realtimex_sdk import RealtimeXSDK, SDKConfig

API_KEY = os.environ.get("RTX_API_KEY")
SERVER_URL = os.environ.get("RTX_URL", "http://localhost:3001")
AGENT_ID = sys.argv[1] if len(sys.argv) > 1 else "claude"
CWD = sys.argv[2] if len(sys.argv) > 2 else os.getcwd()

exit_code = 0


def section(title: str):
    print(f"\n{'=' * 60}")
    print(f"  {title}")
    print("=" * 60)


def ok(msg: str):
    print(f"  [PASS] {msg}")


def fail(msg: str, err=None):
    global exit_code
    print(f"  [FAIL] {msg}")
    if err:
        print(f"         {err}")
    exit_code = 1


def info(msg: str):
    print(f"  {msg}")


async def main():
    if not API_KEY:
        print("Error: RTX_API_KEY environment variable is required.")
        sys.exit(1)

    print("ACP Bridge Verification (Python)")
    info(f"Server:   {SERVER_URL}")
    info(f"Agent:    {AGENT_ID}")
    info(f"CWD:      {CWD}")

    sdk = RealtimeXSDK(config=SDKConfig(
        url=SERVER_URL,
        api_key=API_KEY,
    ))

    # Step 1
    section("Step 1: List Available Agents")
    try:
        agents = await sdk.acp_agent.list_agents()
        info(f"Found {len(agents)} agent(s):")
        for a in agents:
            info(f"  - {a.id} ({a.label}) installed={a.installed} authReady={a.authReady}")
        target = next((a for a in agents if AGENT_ID in (a.handles or [])), None)
        if not target:
            fail(f'Agent "{AGENT_ID}" not found in provider list')
            return
        if not target.installed:
            fail(f'Agent "{AGENT_ID}" is not installed')
            return
        ok("Agent discovery works")
    except Exception as e:
        fail("list_agents() failed", e)
        return

    # Step 2
    section("Step 2: Create Session")
    try:
        session = await sdk.acp_agent.create_session(
            AGENT_ID, cwd=CWD, label="verify-py", approval_policy="approve-all"
        )
        session_key = session.session_key
        info(f"Session key:  {session_key}")
        info(f"State:        {session.state}")
        if session.state != "ready":
            fail(f'Expected state "ready", got "{session.state}"')
            return
        ok("Session created successfully")
    except Exception as e:
        fail("create_session() failed", e)
        return

    # Step 3
    section("Step 3: Get Session Status")
    try:
        status = await sdk.acp_agent.get_session(session_key)
        info(f"State:           {status.state}")
        info(f"Runtime options: {status.runtime_options}")
        ok("Session status retrieved")
    except Exception as e:
        fail("get_session() failed", e)

    # Step 4
    section("Step 4: Sync Chat")
    try:
        info('Sending: "What is 2+2? Reply with just the number."')
        resp = await sdk.acp_agent.chat(session_key, "What is 2+2? Reply with just the number.")
        info(f'Response text:  "{resp.text.strip()}"')
        info(f"Stop reason:    {resp.stop_reason or '(none)'}")
        if not resp.text:
            fail("Empty response text")
        else:
            ok("Sync chat works")
    except Exception as e:
        fail("chat() failed", e)

    # Step 5
    section("Step 5: Streaming Chat (SSE)")
    try:
        info('Sending: "Say hello in 3 languages, one per line."')
        event_counts: dict = {}
        full_text = ""
        async for event in sdk.acp_agent.stream_chat(session_key, "Say hello in 3 languages, one per line."):
            event_counts[event.type] = event_counts.get(event.type, 0) + 1
            if event.type == "text_delta":
                full_text += event.data.get("text", "")
        info(f"Events received: {event_counts}")
        info(f'Full text (first 200 chars): "{full_text[:200].strip()}"')
        if not full_text:
            fail("No text_delta events received")
        else:
            ok("Streaming chat works")
    except Exception as e:
        fail("stream_chat() failed", e)

    # Step 6
    section("Step 6: Patch Runtime Options")
    try:
        await sdk.acp_agent.patch_session(session_key, timeoutSeconds=300)
        status = await sdk.acp_agent.get_session(session_key)
        info(f"Updated options: {status.runtime_options}")
        ok("Patch session works")
    except Exception as e:
        fail("patch_session() failed", e)

    # Step 7
    section("Step 7: Close Session")
    try:
        await sdk.acp_agent.close_session(session_key, reason="verify-complete")
        ok("Session closed")
        try:
            await sdk.acp_agent.get_session(session_key)
            fail("Session still accessible after close")
        except Exception:
            ok("Session correctly inaccessible after close")
    except Exception as e:
        fail("close_session() failed", e)

    # Summary
    section("Summary")
    if exit_code:
        print("  Some checks FAILED. See output above.")
    else:
        print("  All checks PASSED.")


if __name__ == "__main__":
    asyncio.run(main())
    sys.exit(exit_code)
