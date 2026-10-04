#!/usr/bin/env node
// Build-time copy of the common fixed runner/helper. Never resolves credentials.
import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../src/himalaya/", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const files = ["runner.cjs", "password.cjs"];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const argv = process.argv.slice(2);
if (argv.length !== 3 || !["--check", "--write"].includes(argv[0]) || argv[1] !== "--output" || !path.isAbsolute(argv[2])) {
  process.stderr.write("Usage: export-himalaya-host.mjs <--check|--write> --output <absolute host asset directory>\n");
  process.exitCode = 1;
} else {
  const output = argv[2];
  const snapshots = files.map(name => ({ name, bytes: readFileSync(path.join(source, name)) }));
  const manifest = { package: pkg.name, version: pkg.version, contractVersion: "himalaya-execution@1",
    sourceRepository: "https://github.com/therealtimex/realtimex-sdk", license: pkg.license,
    files: Object.fromEntries(snapshots.map(({ name, bytes }) => [name, hash(bytes)])) };
  try {
    if (argv[0] === "--check") {
      const installed = JSON.parse(readFileSync(path.join(output, "sdk-manifest.json"), "utf8"));
      if (JSON.stringify(installed) !== JSON.stringify(manifest) ||
          snapshots.some(({ name }) => hash(readFileSync(path.join(output, name))) !== manifest.files[name])) throw new Error();
    } else {
      mkdirSync(output, { recursive: true });
      const atomicWrite = (name, bytes) => {
        const target = path.join(output, name);
        const temporary = path.join(output, "." + name + "." + randomUUID());
        writeFileSync(temporary, bytes, { mode: 0o644, flag: "wx" });
        renameSync(temporary, target);
      };
      for (const { name, bytes } of snapshots) atomicWrite(name, bytes);
      atomicWrite("sdk-manifest.json", JSON.stringify(manifest, null, 2) + "\n");
    }
    process.stdout.write(JSON.stringify({ ok: true, mode: argv[0].slice(2), ...manifest }) + "\n");
  } catch {
    process.stderr.write("Host Himalaya assets do not match the selected SDK source/version.\n");
    process.exitCode = 1;
  }
}
