#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const LOCAL_APP_CONTRACT_VERSION = "local-app-contract/v1";
const CONTRACT_ENDPOINT_PATH = "/contracts/local-app/v1";
const REQUIRED_EVENTS = [
  "task.trigger",
  "system.ping",
  "task.claimed",
  "task.started",
  "task.progress",
  "task.completed",
  "task.failed",
  "task.canceled",
];

function logInfo(message) {
  console.log(`[contract-compat] ${message}`);
}

function fail(message, details = "") {
  console.error(`[contract-compat] ERROR: ${message}`);
  if (details) {
    console.error(details);
  }
  process.exit(1);
}

function normalizeBaseUrl(urlLike) {
  return String(urlLike || "http://127.0.0.1:3001").replace(/\/+$/, "");
}

function sortedUnique(values) {
  return Array.from(new Set(values || [])).sort();
}

function assertContractShape(contract, label) {
  if (!contract || typeof contract !== "object") {
    fail(`${label} did not return a valid contract object.`);
  }

  if (contract.version !== LOCAL_APP_CONTRACT_VERSION) {
    fail(
      `${label} returned unexpected contract version.`,
      `Expected: ${LOCAL_APP_CONTRACT_VERSION}\nReceived: ${String(contract.version)}`
    );
  }

  const supportedEvents = Array.isArray(contract.supported_events)
    ? contract.supported_events
    : [];

  const missingEvents = REQUIRED_EVENTS.filter(
    (eventName) => !supportedEvents.includes(eventName)
  );

  if (missingEvents.length > 0) {
    fail(
      `${label} is missing required contract events.`,
      `Missing: ${missingEvents.join(", ")}`
    );
  }

  if (!contract.callback || typeof contract.callback !== "object") {
    fail(`${label} is missing callback contract metadata.`);
  }

  const eventIdHeader = contract.callback.event_id_header;
  const signatureHeader = contract.callback.signature_header;

  if (eventIdHeader !== "x-rtx-event-id") {
    fail(
      `${label} returned unexpected callback event ID header.`,
      `Expected: x-rtx-event-id\nReceived: ${String(eventIdHeader)}`
    );
  }

  if (signatureHeader !== "x-rtx-contract-signature") {
    fail(
      `${label} returned unexpected callback signature header.`,
      `Expected: x-rtx-contract-signature\nReceived: ${String(signatureHeader)}`
    );
  }
}

function compareEventSets(referenceEvents, candidateEvents, candidateLabel) {
  const reference = sortedUnique(referenceEvents);
  const candidate = sortedUnique(candidateEvents);

  if (reference.length !== candidate.length) {
    fail(
      `Event count mismatch for ${candidateLabel}.`,
      `Main App: ${reference.join(", ")}\n${candidateLabel}: ${candidate.join(", ")}`
    );
  }

  for (let i = 0; i < reference.length; i += 1) {
    if (reference[i] !== candidate[i]) {
      fail(
        `Event set mismatch for ${candidateLabel}.`,
        `Main App: ${reference.join(", ")}\n${candidateLabel}: ${candidate.join(", ")}`
      );
    }
  }
}

async function fetchJsonOrThrow(url, options) {
  const response = await fetch(url, options);
  const textBody = await response.text();
  let jsonBody = null;
  try {
    jsonBody = textBody ? JSON.parse(textBody) : null;
  } catch {
    jsonBody = null;
  }
  return { response, textBody, jsonBody };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const tsDir = path.join(repoRoot, "typescript");
const tsDistEntry = path.join(tsDir, "dist", "index.mjs");

const baseUrl = normalizeBaseUrl(
  process.env.RTX_CONTRACT_VERIFY_BASE_URL ||
    process.env.REALTIMEX_URL ||
    process.env.RTX_URL
);
const apiKey =
  process.env.RTX_CONTRACT_VERIFY_API_KEY || process.env.RTX_API_KEY || "";
const appId =
  process.env.RTX_CONTRACT_VERIFY_APP_ID || process.env.RTX_APP_ID || "";
const appName =
  process.env.RTX_CONTRACT_VERIFY_APP_NAME || process.env.RTX_APP_NAME || "ContractVerifier";
const timeoutMs = Number(process.env.RTX_CONTRACT_VERIFY_TIMEOUT_MS || 15000);

if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  fail("Invalid timeout value. Set RTX_CONTRACT_VERIFY_TIMEOUT_MS to a positive number.");
}

if (!apiKey && !appId) {
  fail(
    "Missing credentials. Set RTX_API_KEY (recommended) or RTX_APP_ID.",
    "This endpoint requires auth and permission api.contracts."
  );
}

const headers = {
  "Content-Type": "application/json",
};
if (apiKey) {
  headers.Authorization = `Bearer ${apiKey}`;
}
if (appId) {
  headers["x-app-id"] = appId;
}

const endpointUrl = `${baseUrl}${CONTRACT_ENDPOINT_PATH}`;
logInfo(`Checking Main App contract endpoint: ${endpointUrl}`);

let mainAppContract;
try {
  const { response, textBody, jsonBody } = await fetchJsonOrThrow(endpointUrl, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const permissionHint =
      jsonBody?.error === "PERMISSION_REQUIRED" || jsonBody?.error === "PERMISSION_DENIED"
        ? "\nHint: use RTX_API_KEY (dev mode) or grant api.contracts for RTX_APP_ID."
        : "";
    fail(
      `Main App contract endpoint returned HTTP ${response.status}.`,
      `${textBody || "(empty response)"}${permissionHint}`
    );
  }

  if (!jsonBody || jsonBody.success !== true) {
    fail(
      "Main App contract endpoint did not return a success payload.",
      textBody || "(empty response)"
    );
  }

  mainAppContract = jsonBody.contract;
  assertContractShape(mainAppContract, "Main App endpoint");
  logInfo("Main App endpoint contract check passed.");
} catch (error) {
  fail("Failed to fetch Main App contract endpoint.", String(error?.message || error));
}

logInfo("Building TypeScript SDK before compatibility check.");
const tsBuild = spawnSync("npm", ["run", "build"], {
  cwd: tsDir,
  encoding: "utf8",
});

if (tsBuild.status !== 0) {
  fail(
    "TypeScript SDK build failed.",
    `${tsBuild.stdout || ""}\n${tsBuild.stderr || ""}`.trim()
  );
}

if (!fs.existsSync(tsDistEntry)) {
  fail(
    "TypeScript dist entry was not generated.",
    `Expected file: ${tsDistEntry}`
  );
}

logInfo("Checking contract fetch through TypeScript SDK.");
const tsModule = await import(`${pathToFileURL(tsDistEntry).href}?t=${Date.now()}`);
if (!tsModule?.RealtimeXSDK) {
  fail("Could not load RealtimeXSDK from TypeScript dist build.");
}

const tsSdk = new tsModule.RealtimeXSDK({
  realtimex: {
    url: baseUrl,
    appId: appId || undefined,
    appName,
    apiKey: apiKey || undefined,
  },
});

const tsContract = await tsSdk.contract.getLocalAppV1(true);
assertContractShape(tsContract, "TypeScript SDK");
compareEventSets(mainAppContract.supported_events, tsContract.supported_events, "TypeScript SDK");
logInfo("TypeScript SDK contract check passed.");

logInfo("Checking contract fetch through Python SDK.");
const pythonScript = `
import asyncio
import json
import os
import sys

repo_root = os.environ["RTX_CONTRACT_VERIFY_REPO_ROOT"]
base_url = os.environ["RTX_CONTRACT_VERIFY_BASE_URL"]
api_key = os.environ.get("RTX_CONTRACT_VERIFY_API_KEY", "")
app_id = os.environ.get("RTX_CONTRACT_VERIFY_APP_ID", "")
app_name = os.environ.get("RTX_CONTRACT_VERIFY_APP_NAME", "ContractVerifier")

sys.path.insert(0, os.path.join(repo_root, "python"))

from realtimex_sdk import RealtimeXSDK, SDKConfig

async def main():
    config = SDKConfig(
        url=base_url,
        app_id=app_id or None,
        app_name=app_name,
        api_key=api_key or None,
    )
    sdk = RealtimeXSDK(config=config)
    contract = await sdk.contract.get_local_app_v1(force_refresh=True)
    print(json.dumps({"ok": True, "contract": contract}))

asyncio.run(main())
`;

const pyRun = spawnSync("python3", ["-c", pythonScript], {
  cwd: repoRoot,
  encoding: "utf8",
  env: {
    ...process.env,
    RTX_CONTRACT_VERIFY_REPO_ROOT: repoRoot,
    RTX_CONTRACT_VERIFY_BASE_URL: baseUrl,
    RTX_CONTRACT_VERIFY_API_KEY: apiKey,
    RTX_CONTRACT_VERIFY_APP_ID: appId,
    RTX_CONTRACT_VERIFY_APP_NAME: appName,
  },
});

if (pyRun.status !== 0) {
  fail(
    "Python SDK contract check failed to execute.",
    `${pyRun.stdout || ""}\n${pyRun.stderr || ""}`.trim()
  );
}

const pyLines = String(pyRun.stdout || "")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);
const pyLastLine = pyLines[pyLines.length - 1] || "";

let pyPayload = null;
try {
  pyPayload = JSON.parse(pyLastLine);
} catch (error) {
  fail(
    "Python SDK check did not return valid JSON payload.",
    `${String(error?.message || error)}\nOutput:\n${pyRun.stdout || "(empty)"}`
  );
}

if (!pyPayload || pyPayload.ok !== true) {
  fail(
    "Python SDK check did not return success payload.",
    pyLastLine || "(empty)"
  );
}

const pyContract = pyPayload.contract;
assertContractShape(pyContract, "Python SDK");
compareEventSets(mainAppContract.supported_events, pyContract.supported_events, "Python SDK");
logInfo("Python SDK contract check passed.");

console.log("");
console.log("Contract compatibility checks passed.");
console.log(`Main App: ${LOCAL_APP_CONTRACT_VERSION} @ ${endpointUrl}`);
console.log(`Event count: ${sortedUnique(mainAppContract.supported_events).length}`);
