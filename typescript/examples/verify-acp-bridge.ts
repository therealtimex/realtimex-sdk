#!/usr/bin/env npx tsx
/**
 * ACP Bridge Verification Script
 *
 * Exercises the full ACP bridge flow against a live RealTimeX server:
 *   1. List available CLI agents
 *   2. Create a session (with approvalPolicy for sync chat)
 *   3. Get session status
 *   4. Sync chat turn
 *   5. Streaming chat turn (SSE)
 *   6. Patch runtime options
 *   7. Close session
 *
 * Usage:
 *   RTX_API_KEY=<key> npx tsx examples/verify-acp-bridge.ts [agent_id] [cwd]
 *
 * Defaults:
 *   agent_id = "claude"
 *   cwd      = process.cwd()
 *   server   = http://localhost:3001
 */

import { RealtimeXSDK } from "../src/index";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_KEY = process.env.RTX_API_KEY;
const SERVER_URL = process.env.RTX_URL || "http://localhost:3001";
const AGENT_ID = process.argv[2] || "claude";
const CWD = process.argv[3] || process.cwd();

if (!API_KEY) {
  console.error("Error: RTX_API_KEY environment variable is required.");
  console.error("Usage: RTX_API_KEY=<key> npx tsx examples/verify-acp-bridge.ts [agent_id] [cwd]");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function section(title: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

function ok(msg: string) {
  console.log(`  [PASS] ${msg}`);
}

function fail(msg: string, err?: unknown) {
  console.error(`  [FAIL] ${msg}`);
  if (err instanceof Error) console.error(`         ${err.message}`);
  process.exitCode = 1;
}

function info(msg: string) {
  console.log(`  ${msg}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("ACP Bridge Verification");
  console.log(`  Server:   ${SERVER_URL}`);
  console.log(`  Agent:    ${AGENT_ID}`);
  console.log(`  CWD:      ${CWD}`);

  const sdk = new RealtimeXSDK({
    realtimex: { url: SERVER_URL, apiKey: API_KEY, appId: "" },
  });

  // -----------------------------------------------------------------------
  // Step 1: List agents
  // -----------------------------------------------------------------------
  section("Step 1: List Available Agents");
  let agents;
  try {
    agents = await sdk.acpAgent.listAgents();
    info(`Found ${agents.length} agent(s):`);
    for (const a of agents) {
      info(`  - ${a.id} (${a.label}) installed=${a.installed} authReady=${a.authReady}`);
    }
    const target = agents.find((a) => a.handles?.includes(AGENT_ID));
    if (!target) {
      fail(`Agent "${AGENT_ID}" not found in provider list`);
      return;
    }
    if (!target.installed) {
      fail(`Agent "${AGENT_ID}" is not installed`);
      return;
    }
    ok("Agent discovery works");
  } catch (err) {
    fail("listAgents() failed", err);
    return;
  }

  // -----------------------------------------------------------------------
  // Step 2: Create session
  // -----------------------------------------------------------------------
  section("Step 2: Create Session");
  let sessionKey: string;
  try {
    const session = await sdk.acpAgent.createSession({
      agent_id: AGENT_ID,
      cwd: CWD,
      label: "verify-script",
      approvalPolicy: "approve-all",
    });
    sessionKey = session.session_key;
    info(`Session key:  ${sessionKey}`);
    info(`State:        ${session.state}`);
    info(`Backend:      ${session.backend_id}`);
    if (session.state !== "ready") {
      fail(`Expected state "ready", got "${session.state}"`);
      return;
    }
    ok("Session created successfully");
  } catch (err) {
    fail("createSession() failed", err);
    return;
  }

  // -----------------------------------------------------------------------
  // Step 3: Get session status
  // -----------------------------------------------------------------------
  section("Step 3: Get Session Status");
  try {
    const status = await sdk.acpAgent.getSession(sessionKey);
    info(`State:           ${status.state}`);
    info(`Runtime options: ${JSON.stringify(status.runtime_options)}`);
    info(`Last activity:   ${status.last_activity_at}`);
    ok("Session status retrieved");
  } catch (err) {
    fail("getSession() failed", err);
  }

  // -----------------------------------------------------------------------
  // Step 4: Sync chat
  // -----------------------------------------------------------------------
  section("Step 4: Sync Chat");
  try {
    info('Sending: "What is 2+2? Reply with just the number."');
    const response = await sdk.acpAgent.chat(sessionKey, "What is 2+2? Reply with just the number.");
    info(`Response text:  "${response.text.trim()}"`);
    info(`Stop reason:    ${response.stop_reason || "(none)"}`);
    if (!response.text) {
      fail("Empty response text");
    } else {
      ok("Sync chat works");
    }
  } catch (err) {
    fail("chat() failed", err);
  }

  // -----------------------------------------------------------------------
  // Step 5: Streaming chat (same session — verifies multi-turn works)
  // -----------------------------------------------------------------------
  section("Step 5: Streaming Chat (SSE)");
  try {
    info('Sending: "Say hello in 3 languages, one per line."');
    const eventCounts: Record<string, number> = {};
    let fullText = "";

    for await (const event of sdk.acpAgent.streamChat(sessionKey, "Say hello in 3 languages, one per line.")) {
      eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;
      if (event.type === "text_delta") {
        fullText += (event.data.text as string) || "";
      }
    }

    info(`Events received: ${JSON.stringify(eventCounts)}`);
    info(`Full text (first 200 chars): "${fullText.slice(0, 200).trim()}"`);
    if (!fullText) {
      fail("No text_delta events received");
    } else {
      ok("Streaming chat works");
    }
  } catch (err) {
    fail("streamChat() failed", err);
  }

  // -----------------------------------------------------------------------
  // Step 6: Patch runtime options
  // -----------------------------------------------------------------------
  section("Step 6: Patch Runtime Options");
  try {
    await sdk.acpAgent.patchSession(sessionKey, { timeoutSeconds: 300 });
    const status = await sdk.acpAgent.getSession(sessionKey);
    info(`Updated options: ${JSON.stringify(status.runtime_options)}`);
    ok("Patch session works");
  } catch (err) {
    fail("patchSession() failed", err);
  }

  // -----------------------------------------------------------------------
  // Step 7: List sessions
  // -----------------------------------------------------------------------
  section("Step 7: List Sessions");
  try {
    const sessions = await sdk.acpAgent.listSessions();
    info(`Active sessions: ${sessions.length}`);
    const ours = sessions.find((s) => s.session_key === sessionKey);
    if (!ours) {
      fail("Our session not found in list");
    } else {
      ok("Session appears in list");
    }
  } catch (err) {
    fail("listSessions() failed", err);
  }

  // -----------------------------------------------------------------------
  // Step 8: Close session
  // -----------------------------------------------------------------------
  section("Step 8: Close Session");
  try {
    await sdk.acpAgent.closeSession(sessionKey, "verify-complete");
    ok("Session closed");

    // Verify it's gone
    try {
      await sdk.acpAgent.getSession(sessionKey);
      fail("Session still accessible after close");
    } catch {
      ok("Session correctly inaccessible after close");
    }
  } catch (err) {
    fail("closeSession() failed", err);
  }

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  section("Summary");
  if (process.exitCode) {
    console.log("  Some checks FAILED. See output above.");
  } else {
    console.log("  All checks PASSED.");
  }
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
