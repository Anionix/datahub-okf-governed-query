/// <reference types="node" />

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const checker = fileURLToPath(new URL("../check-pnpm-settings.mjs", import.meta.url));
const reviewedConfig = '{"@modelcontextprotocol/sdk":"1.29.0","zod":"4.4.3"}\n';
const reviewedLock = `lockfileVersion: '9.0'

overrides:
  '@modelcontextprotocol/sdk': 1.29.0
  zod: 4.4.3

importers: {}
`;

/**
 * @param {import("node:test").TestContext} context
 * @param {{
 *   packageJson?: unknown, lockfile?: string, config?: string,
 *   diagnostics?: string, probeStatus?: number
 * }} fixture
 */
function runFixture(context, fixture = {}) {
  const root = mkdtempSync(join(tmpdir(), "check-pnpm-settings-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "package.json"), `${JSON.stringify(fixture.packageJson ?? {})}\n`);
  writeFileSync(join(root, "pnpm-lock.yaml"), fixture.lockfile ?? reviewedLock);

  const bin = join(root, "bin");
  mkdirSync(bin);
  const fakePnpm = join(bin, "pnpm");
  writeFileSync(
    fakePnpm,
    `#!/usr/bin/env node
process.stdout.write(${JSON.stringify(fixture.config ?? reviewedConfig)});
process.stderr.write(${JSON.stringify(fixture.diagnostics ?? "")});
process.exitCode = ${fixture.probeStatus ?? 0};
`,
  );
  chmodSync(fakePnpm, 0o755);

  const inheritedPath = Object.entries(process.env).find(([key]) => key === "PATH")?.[1] ?? "";
  return spawnSync(process.execPath, [checker, root], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}${delimiter}${inheritedPath}` },
  });
}

/**
 * @param {import("node:child_process").SpawnSyncReturns<string>} result
 * @param {string} reason
 */
function assertRejected(result, reason) {
  assert.doesNotMatch(result.stderr, /Cannot find module|MODULE_NOT_FOUND/u);
  assert.notEqual(result.status, 0, "expected pnpm settings gate to reject fixture");
  assert.match(result.stderr, new RegExp(reason, "u"));
}

test("accepts the reviewed effective overrides and lock entries", (context) => {
  const result = runFixture(context);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("rejects reintroduced package.json pnpm overrides", (context) => {
  const result = runFixture(context, {
    packageJson: { pnpm: { overrides: { zod: "0.0.0" } } },
  });
  assertRejected(result, "IgnoredPnpmSettings");
});

test("rejects pnpm ignored-settings diagnostics even with exit zero", (context) => {
  const result = runFixture(context, {
    diagnostics:
      'The "pnpm" field in package.json is no longer read by pnpm. ' +
      'The following keys were ignored: "pnpm.overrides".\n',
  });
  assertRejected(result, "IgnoredPnpmSettings");
});

test("rejects an unreviewed effective override", (context) => {
  const result = runFixture(context, {
    config: '{"@modelcontextprotocol/sdk":"1.29.0","zod":"0.0.0"}\n',
  });
  assertRejected(result, "EffectiveOverrides");
});

test("rejects an unreviewed lockfile override", (context) => {
  const result = runFixture(context, {
    lockfile: reviewedLock.replace("zod: 4.4.3", "zod: 0.0.0"),
  });
  assertRejected(result, "LockfileOverrides");
});
