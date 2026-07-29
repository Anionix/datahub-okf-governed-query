/// <reference types="node" />

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// pnpm 11 settings source: non-auth settings live in pnpm-workspace.yaml.
// https://pnpm.io/configuring
// Override semantics source: overrides are root-only dependency resolutions.
// https://pnpm.io/settings#overrides

const EXPECTED_LOCK_OVERRIDES = ["  '@modelcontextprotocol/sdk': 1.29.0", "  zod: 4.4.3"];
const IGNORED_SETTINGS =
  /The "pnpm" field in package\.json is no longer read by pnpm\.[\s\S]*keys were ignored:/u;

class PnpmSettingsError extends Error {
  /** @param {string} kind */
  constructor(kind) {
    super(`pnpm-settings:${kind}`);
    this.name = "PnpmSettingsError";
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/** @param {string} lockfile */
function assertLockOverrides(lockfile) {
  const lines = lockfile.split(/\r?\n/u);
  const headings = lines
    .map((line, index) => ({ index, line }))
    .filter(({ line }) => /^(?:overrides|'overrides'|"overrides"):/u.test(line));
  if (headings.length !== 1 || headings[0]?.line !== "overrides:") {
    throw new PnpmSettingsError("LockfileOverrides");
  }
  const start = (headings[0]?.index ?? -1) + 1;
  let end = start;
  while (end < lines.length && (lines[end] === "" || /^[ \t]/u.test(lines[end] ?? ""))) {
    end += 1;
  }
  const actual = lines.slice(start, end);
  while (actual.at(-1) === "") {
    actual.pop();
  }
  if (
    actual.length !== EXPECTED_LOCK_OVERRIDES.length ||
    !actual.every((line, index) => line === EXPECTED_LOCK_OVERRIDES[index])
  ) {
    throw new PnpmSettingsError("LockfileOverrides");
  }
}

/** @param {unknown} value */
function assertEffectiveOverrides(value) {
  const unexpected = isRecord(value)
    ? Object.entries(value).some(
        ([key, actual]) =>
          (key === "@modelcontextprotocol/sdk" && actual !== "1.29.0") ||
          (key === "zod" && actual !== "4.4.3") ||
          (key !== "@modelcontextprotocol/sdk" && key !== "zod"),
      )
    : true;
  if (!isRecord(value) || Object.keys(value).length !== 2 || unexpected) {
    throw new PnpmSettingsError("EffectiveOverrides");
  }
}

// LLM-CONTRACT:
// Accepts: repository package manifest lockfile and effective pinned pnpm configuration
// Emits: success only for the reviewed effective overrides and matching lock entries
// Failure: rejects ignored malformed missing duplicate stale or unverified settings
// Invariant: the probe reads configuration without installing packages or running scripts
function main() {
  const root = resolve(process.argv[2] ?? ".");
  /** @type {unknown} */
  let packageManifest;
  /** @type {string} */
  let lockfile;
  try {
    packageManifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    lockfile = readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8");
  } catch {
    throw new PnpmSettingsError("RepositoryState");
  }
  if (!isRecord(packageManifest)) {
    throw new PnpmSettingsError("RepositoryState");
  }
  if (Object.hasOwn(packageManifest, "pnpm")) {
    throw new PnpmSettingsError("IgnoredPnpmSettings");
  }
  assertLockOverrides(lockfile);

  const probe = spawnSync("pnpm", ["config", "get", "overrides", "--json", "--color=false"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1_048_576,
    timeout: 30_000,
  });
  const diagnostics = `${probe.stdout ?? ""}\n${probe.stderr ?? ""}`;
  if (IGNORED_SETTINGS.test(diagnostics)) {
    throw new PnpmSettingsError("IgnoredPnpmSettings");
  }
  if (probe.error !== undefined || probe.status !== 0) {
    throw new PnpmSettingsError("PnpmProbe");
  }
  /** @type {unknown} */
  let effectiveOverrides;
  try {
    effectiveOverrides = JSON.parse(probe.stdout);
  } catch {
    throw new PnpmSettingsError("EffectiveOverrides");
  }
  assertEffectiveOverrides(effectiveOverrides);
}

try {
  main();
} catch (error) {
  console.error(
    error instanceof PnpmSettingsError ? error.message : "pnpm-settings:InternalFailure",
  );
  process.exitCode = 1;
}
