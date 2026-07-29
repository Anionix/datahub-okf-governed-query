/// <reference types="node" />

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const checker = fileURLToPath(new URL("../check-tcb.mjs", import.meta.url));
const sourcePath = "packages/contracts/src/transition.ts";
const clauses = {
  accepts: "validated input",
  emits: "validated output",
  failure: "rejects invalid input",
  invariant: "ambient authority is unchanged",
};
const contract = `// LLM-CONTRACT:
// Accepts: ${clauses.accepts}
// Emits: ${clauses.emits}
// Failure: ${clauses.failure}
// Invariant: ${clauses.invariant}
`;
const transitionSource = `${contract}export function transition(value: unknown): unknown {
  return value;
}
`;

/**
 * @typedef {{
 *   root: string, path: string, symbol: string, accepts: string, emits: string,
 *   failure: string, invariant: string
 * }} Transition
 * @typedef {{
 *   manifest: unknown, files?: Readonly<Record<string, string>>,
 *   manifestText?: string, roots?: readonly string[] | null
 * }} Fixture
 */

/** @returns {Transition} */
function entry(path = sourcePath, symbol = "transition") {
  return { root: "contracts", path, symbol, ...clauses };
}

/** @param {readonly Transition[]} transitions */
function manifest(transitions = []) {
  return { apiVersion: "security-transitions/v1", transitions };
}

/** @param {string} symbol */
function exportedSource(symbol) {
  return `${contract}export function ${symbol}(): void {}\n`;
}

/**
 * @param {import("node:test").TestContext} context
 * @param {Fixture} fixture
 */
function runFixture(context, fixture) {
  const repository = mkdtempSync(join(tmpdir(), "check-tcb-"));
  context.after(() => rmSync(repository, { recursive: true, force: true }));
  mkdirSync(join(repository, "packages/contracts/src"), { recursive: true });
  const manifestPath = join(repository, "security-transitions.json");
  writeFileSync(manifestPath, fixture.manifestText ?? `${JSON.stringify(fixture.manifest)}\n`);

  for (const [path, source] of Object.entries(fixture.files ?? {})) {
    const target = join(repository, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
  }

  const arguments_ = [checker, "--manifest", manifestPath];
  if (fixture.roots !== null) {
    arguments_.push("--roots", ...(fixture.roots ?? ["contracts"]));
  }
  return spawnSync(process.execPath, arguments_, {
    cwd: repository,
    encoding: "utf8",
  });
}

/** @param {import("node:child_process").SpawnSyncReturns<string>} result */
function assertAccepted(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

/** @param {import("node:child_process").SpawnSyncReturns<string>} result */
function assertRejected(result) {
  assert.doesNotMatch(
    result.stderr,
    /Cannot find module|MODULE_NOT_FOUND/,
    "checker CLI is missing",
  );
  assert.notEqual(result.status, 0, "expected the public CLI to reject the fixture");
}

test("uses only the bare stable TypeScript Compiler API import", () => {
  const source = readFileSync(checker, "utf8");
  /** @type {unknown} */
  const compilerPackage = createRequire(import.meta.url)("typescript/package.json");
  assert.ok(
    typeof compilerPackage === "object" && compilerPackage !== null && "version" in compilerPackage,
  );
  assert.equal(compilerPackage.version, "6.0.2");
  assert.equal(ts.version, "6.0.3");
  assert.equal(typeof ts.createSourceFile, "function");
  assert.match(source, /from "typescript";/u);
  assert.doesNotMatch(source, /@typescript\/native|typescript\/unstable\//u);
});

test("accepts an empty current manifest", (context) => {
  assertAccepted(runFixture(context, { manifest: manifest([]) }));
});

test("accepts a current registered transition", (context) => {
  assertAccepted(
    runFixture(context, {
      manifest: manifest([entry()]),
      files: { [sourcePath]: transitionSource },
    }),
  );
});

const aPath = "packages/contracts/src/a.ts";
const bPath = "packages/contracts/src/b.ts";
const outsidePath = "packages/contracts/test/transition.ts";

/** @type {readonly ({ name: string } & Fixture)[]} */
const manifestRejections = [
  {
    name: "invalid manifest schema",
    manifest: { apiVersion: "security-transitions/v2", transitions: [] },
  },
  {
    name: "unknown manifest key",
    manifest: { ...manifest([]), unexpected: true },
  },
  {
    name: "entries outside raw UTF-8 order",
    manifest: manifest([entry(bPath, "b"), entry(aPath, "a")]),
    files: { [aPath]: exportedSource("a"), [bPath]: exportedSource("b") },
  },
  {
    name: "duplicate path and symbol entries",
    manifest: manifest([entry(), entry()]),
    files: { [sourcePath]: transitionSource },
  },
  {
    name: "path outside its fixed root",
    manifest: manifest([entry(outsidePath)]),
    files: { [outsidePath]: transitionSource },
  },
  {
    name: "unknown manifest root",
    manifest: manifest([{ ...entry(), root: "future" }]),
    roots: null,
  },
  {
    name: "missing registered path",
    manifest: manifest([entry("packages/contracts/src/missing.ts")]),
  },
  {
    name: "moved registered path",
    manifest: manifest([entry("packages/contracts/src/original.ts")]),
    files: { "packages/contracts/src/moved.ts": "const present = true;\n" },
  },
  {
    name: "stale entry whose entire root is absent by default",
    manifest: manifest([
      {
        ...entry("packages/policy-compiler/src/missing.ts"),
        root: "compiler",
      },
    ]),
    roots: null,
  },
];

for (const { name, ...fixture } of manifestRejections) {
  test(`rejects ${name}`, (context) => {
    assertRejected(runFixture(context, fixture));
  });
}

/** @type {readonly ({ name: string } & Fixture)[]} */
const contractRejections = [
  {
    name: "missing exported transition registration",
    manifest: manifest([]),
    files: { [sourcePath]: "export function transition(): void {}\n" },
  },
  {
    name: "stale registered symbol",
    manifest: manifest([entry(sourcePath, "missingTransition")]),
    files: { [sourcePath]: "const present = true;\n" },
  },
  {
    name: "contract detached by a statement",
    manifest: manifest([entry()]),
    files: {
      [sourcePath]: `${contract}const intervening = true;\n${transitionSource.slice(contract.length)}`,
    },
  },
  {
    name: "contract clause mismatch",
    manifest: manifest([entry()]),
    files: {
      [sourcePath]: transitionSource.replace(
        `// Accepts: ${clauses.accepts}`,
        "// Accepts: unchecked input",
      ),
    },
  },
  {
    name: "unregistered LLM-CONTRACT comment",
    manifest: manifest([]),
    files: {
      [sourcePath]: `${contract}function helper(value: unknown): unknown {\n  return value;\n}\n`,
    },
  },
  {
    name: "duplicate LLM-CONTRACT comments",
    manifest: manifest([entry()]),
    files: { [sourcePath]: contract + transitionSource },
  },
  {
    name: "single-line block LLM-CONTRACT marker",
    manifest: manifest([]),
    files: { [sourcePath]: "/* LLM-CONTRACT: unregistered */\nfunction helper(): void {}\n" },
  },
  {
    name: "multiline block LLM-CONTRACT marker",
    manifest: manifest([]),
    files: { [sourcePath]: "/*\n * LLM-CONTRACT:\n */\nfunction helper(): void {}\n" },
  },
];

for (const { name, ...fixture } of contractRejections) {
  test(`rejects ${name}`, (context) => {
    assertRejected(runFixture(context, fixture));
  });
}

/** @type {readonly { name: string, source: string }[]} */
const forbiddenFixtures = [
  { name: "any keyword", source: "let value: any;\n" },
  { name: "JSDoc any type", source: "/** @type {any} */\nconst value = 1;\n" },
  { name: "JSDoc all type", source: "/** @type {*} */\nconst value = 1;\n" },
  {
    name: "JSDoc concrete type assertion",
    source:
      'const input: unknown = "x";\n' +
      "const value = /** @type {string} */ (input);\n" +
      "void value;\n",
  },
  { name: "as expression", source: "const narrowed = value as string;\n" },
  { name: "type assertion", source: "const narrowed = <string>value;\n" },
  { name: "non-null expression", source: "const required = value!;\n" },
  { name: "@ts-ignore", source: "// @ts-ignore\nconst ignored: string = 1;\n" },
  { name: "@ts-expect-error", source: "// @ts-expect-error\nconst ignored: string = 1;\n" },
  { name: "@ts-nocheck", source: "// @ts-nocheck\nconst ignored: string = 1;\n" },
  {
    name: "multiline @ts-ignore",
    source: "/* @ts-ignore */\nconst ignored: string = 1;\n",
  },
  {
    name: "multiline @ts-expect-error",
    source: "/* @ts-expect-error */\nconst ignored: string = 1;\n",
  },
  {
    name: "multiline @ts-nocheck",
    source: "/* @ts-nocheck */\nconst ignored: string = 1;\n",
  },
  { name: "registerTool call", source: 'server.registerTool("query", {}, handler);\n' },
  {
    name: "imported writeFile alias",
    source:
      'import { writeFile as persist } from "node:fs";\n' +
      'function boundary(): void { persist("x", "y", () => {}); }\n',
  },
  {
    name: "imported execFileSync alias",
    source:
      'import { execFileSync as run } from "node:child_process";\n' +
      'function boundary(): void { run("true"); }\n',
  },
  { name: "nested shadow", source: "function f(){writeFile();{let writeFile=x;}}" },
  { name: "parameter shadow", source: "function f(){writeFile();g((writeFile)=>writeFile);}" },
  { name: "arrow shadow", source: "const f=()=>[writeFile(),()=>{let writeFile=x}];" },
  { name: "member sink", source: "function f(){const writeFile=safe;fs.writeFile();}" },
  { name: "destructuring property", source: "function f(){const {writeFile:safe}=x;writeFile();}" },
  { name: "default parameter sink", source: "function f(v=writeFile()){const writeFile=safe;}" },
  { name: "top-level nested shadow", source: "{writeFile();{const writeFile=safe;}}" },
  { name: "shorthand sink", source: "function f(){const {writeFile}=fs;writeFile();}" },
  { name: "for-of shorthand", source: "function f(xs){for(const {writeFile} of xs)writeFile();}" },
  { name: "object shorthand sink", source: "function f(){const options={parse};void options;}" },
  {
    name: "object value sink",
    source: "function f(){const options={handler:parse};void options;}",
  },
];

for (const fixture of forbiddenFixtures) {
  test(`rejects forbidden ${fixture.name}`, (context) => {
    assertRejected(
      runFixture(context, {
        manifest: manifest([]),
        files: { [sourcePath]: fixture.source },
      }),
    );
  });
}

const safeNameFixtures = [
  'import type { parse } from "./types.js";\nfunction helper(value: parse): void { void value; }\n',
  "function normalize(query: string): string { return query.trim(); }\n",
  "function helper(value: string): void { const parse = value.trim(); void parse; }\n",
  'import { parse } from "parser";\nfunction helper(parse: string): string { return parse.trim(); }\n',
  "function f(){{const writeFile=safe;void writeFile;}}",
  "function f(){var writeFile=safe;void writeFile;}",
  "function f(){const writeFile=safe;const run=writeFile;void run;}",
  "function f(xs){for(const writeFile of xs)void writeFile;}",
  "function f(){try{}catch(writeFile){void writeFile;}}",
  "function f(){function writeFile(){}writeFile();}",
  "function f(v){switch(v){case 0:const writeFile=safe;void writeFile;}}",
  "function f(){const options={parse:false};void options;}",
];

for (const [index, source] of safeNameFixtures.entries()) {
  test(`accepts safe authority-name shadow ${index + 1}`, (context) => {
    assertAccepted(
      runFixture(context, {
        manifest: manifest([]),
        files: { [sourcePath]: source },
      }),
    );
  });
}

test("rejects parse diagnostics before malformed syntax can pass", (context) => {
  const result = runFixture(context, {
    manifest: manifest([]),
    files: { [sourcePath]: "const broken = ;\n" },
  });
  assertRejected(result);
  assert.match(result.stderr, /SourceParse/u);
});

const authorityAliasFixtures = [
  {
    name: "bound authority alias",
    source:
      "function boundary(): void {\n" +
      "  const run = writeFile.bind(undefined);\n" +
      '  run("x", "y", () => {});\n' +
      "}\n",
  },
  {
    name: "conditional authority alias",
    source:
      "function boundary(flag: boolean): void {\n" +
      "  const run = flag ? writeFile : execFileSync;\n" +
      '  run("true");\n' +
      "}\n",
  },
  {
    name: "object property and destructuring authority alias",
    source:
      "function boundary(): void {\n" +
      "  const holder = { persist: writeFile };\n" +
      "  const { persist: run } = holder;\n" +
      '  run("x", "y", () => {});\n' +
      "}\n",
  },
  {
    name: "assigned transitive authority alias",
    source:
      "function boundary(): void {\n" +
      "  let first = writeFile;\n" +
      "  let second = first;\n" +
      "  second = first;\n" +
      '  second("x", "y", () => {});\n' +
      "}\n",
  },
];

for (const fixture of authorityAliasFixtures) {
  test(`rejects unregistered ${fixture.name}`, (context) => {
    assertRejected(
      runFixture(context, {
        manifest: manifest([]),
        files: { [sourcePath]: fixture.source },
      }),
    );
  });
}

test("rejects dynamic computed invocation", (context) => {
  const result = runFixture(context, {
    manifest: manifest([]),
    files: {
      [sourcePath]: "function dispatch(key: string): void {\n  handlers[key]();\n}\n",
    },
  });
  assertRejected(result);
  assert.match(result.stderr, /DynamicCall/u);
});

test("accepts static string element invocation", (context) => {
  assertAccepted(
    runFixture(context, {
      manifest: manifest([]),
      files: { [sourcePath]: 'function helper(): void { handlers["safe"](); }\n' },
    }),
  );
});

/** @type {readonly {readonly name: string, readonly source: string}[]} */
const anonymousDefaultFixtures = [
  { name: "anonymous default function", source: "export default function (): void {}\n" },
  { name: "anonymous default arrow", source: "export default (): void => {};\n" },
];

for (const fixture of anonymousDefaultFixtures) {
  test(`rejects ${fixture.name}`, (context) => {
    assertRejected(
      runFixture(context, {
        manifest: manifest([]),
        files: { [sourcePath]: fixture.source },
      }),
    );
  });
}

test("accepts registered named default function", (context) => {
  assertAccepted(
    runFixture(context, {
      manifest: manifest([entry()]),
      files: { [sourcePath]: `${contract}export default function transition(): void {}\n` },
    }),
  );
});

test("attributes an anonymous callback authority to its named outer boundary", (context) => {
  assertRejected(
    runFixture(context, {
      manifest: manifest([]),
      files: {
        [sourcePath]:
          "function boundary(): void {\n" +
          '  queueMicrotask(() => writeFile("x", "y", () => {}));\n' +
          "}\n",
      },
    }),
  );
});

test("keeps a nested named authority boundary separate", (context) => {
  const nestedContract = contract
    .trimEnd()
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
  assertAccepted(
    runFixture(context, {
      manifest: manifest([entry(sourcePath, "inner")]),
      files: {
        [sourcePath]:
          "function outer(): void {\n" +
          `${nestedContract}\n` +
          "  function inner(): void {\n" +
          '    writeFile("x", "y", () => {});\n' +
          "  }\n" +
          "}\n",
      },
    }),
  );
});

const unownedAuthorityFixtures = [
  {
    name: "top-level digest invocation",
    source: "digest();\n",
  },
  {
    name: "top-level authority invocation",
    source: 'writeFile("x", "y", () => {});\n',
  },
  {
    name: "top-level authority escape",
    source: "consume(writeFile);\n",
  },
  {
    name: "registerTool alias",
    source:
      "function boundary(): void {\n" +
      "  const register = server.registerTool.bind(server);\n" +
      '  register("query", {}, handler);\n' +
      "}\n",
  },
  {
    name: "class-field arrow authority",
    source:
      "class Worker {\n" +
      "  run = (): void => {\n" +
      '    writeFile("x", "y", () => {});\n' +
      "  };\n" +
      "}\n",
  },
  {
    name: "external value re-export alias",
    source: 'export { writeFile as persist } from "node:fs";\n',
  },
  {
    name: "cross-file value re-export alias",
    source: 'export { persist as save } from "./authority.js";\n',
  },
];

const typeOnlyAuthorityFixtures = [
  "type Artifact = Readonly<{ digest: string }>;\n",
  "interface Artifact { digest: string }\n",
  "type digest = string;\n",
  "function helper<digest>(value: digest): void { void value; }\n",
];

for (const [index, source] of typeOnlyAuthorityFixtures.entries()) {
  test(`accepts a sink name used only in a type ${index + 1}`, (context) => {
    assertAccepted(
      runFixture(context, { manifest: manifest([]), files: { [sourcePath]: source } }),
    );
  });
}

for (const fixture of unownedAuthorityFixtures) {
  test(`rejects ${fixture.name}`, (context) => {
    assertRejected(
      runFixture(context, {
        manifest: manifest([]),
        files: { [sourcePath]: fixture.source },
      }),
    );
  });
}

test("detects namespace direct authority use", (context) => {
  assertRejected(
    runFixture(context, {
      manifest: manifest([]),
      files: {
        [sourcePath]:
          'import * as fs from "node:fs";\n' +
          'function boundary(): void { fs.writeFile("x", "y", () => {}); }\n',
      },
    }),
  );
});

test("detects static string authority element invocation", (context) => {
  assertRejected(
    runFixture(context, {
      manifest: manifest([]),
      files: {
        [sourcePath]: 'function boundary(): void { fs["writeFile"]("x", "y", () => {}); }\n',
      },
    }),
  );
});

const localExportFixtures = [
  "function transition(): void {}\nexport { transition };\n",
  "function transition(): void {}\nexport { transition as publicTransition };\n",
];

for (const [index, source] of localExportFixtures.entries()) {
  test(`rejects unregistered local export list ${index + 1}`, (context) => {
    assertRejected(
      runFixture(context, {
        manifest: manifest([]),
        files: { [sourcePath]: source },
      }),
    );
  });
}

for (const extension of [".mts", ".cts", ".tsx"]) {
  test(`scans governed ${extension} sources`, (context) => {
    const path = `packages/contracts/src/transition${extension}`;
    assertRejected(
      runFixture(context, {
        manifest: manifest([]),
        files: { [path]: "export function transition(): void {}\n" },
      }),
    );
  });
}

for (const extension of [".js", ".mjs", ".cjs", ".jsx"]) {
  test(`rejects ${extension} in a governed typed root`, (context) => {
    const path = `packages/contracts/src/bypass${extension}`;
    assertRejected(
      runFixture(context, {
        manifest: manifest([]),
        files: { [path]: "const bypass = true;\n" },
      }),
    );
  });
}

test("excludes test directories at any depth below scripts", (context) => {
  assertAccepted(
    runFixture(context, {
      manifest: manifest([]),
      roots: ["integration"],
      files: {
        "scripts/unit/test/case.mjs": "export function testOnlyBoundary() {}\n",
      },
    }),
  );
});

test("tracks a named CommonJS export assignment as public", (context) => {
  const path = "packages/contracts/src/transition.cts";
  assertRejected(
    runFixture(context, {
      manifest: manifest([]),
      files: {
        [path]: "function boundary(): void {}\nexport = boundary;\n",
      },
    }),
  );
});

test("accepts a registered named CommonJS export assignment", (context) => {
  const path = "packages/contracts/src/transition.cts";
  assertAccepted(
    runFixture(context, {
      manifest: manifest([entry(path, "boundary")]),
      files: {
        [path]: `${contract}function boundary(): void {}\nexport = boundary;\n`,
      },
    }),
  );
});

test("rejects an untrackable CommonJS export assignment", (context) => {
  assertRejected(
    runFixture(context, {
      manifest: manifest([]),
      files: {
        "packages/contracts/src/transition.cts": "export = (): void => {};\n",
      },
    }),
  );
});

test("rejects one contract header shared by multiple boundaries", (context) => {
  assertRejected(
    runFixture(context, {
      manifest: manifest([entry(sourcePath, "first"), entry(sourcePath, "second")]),
      files: {
        [sourcePath]: `${contract}export const first = (): void => {}, second = (): void => {};\n`,
      },
    }),
  );
});

test("rejects raw JSON duplicate keys recursively", (context) => {
  assertRejected(
    runFixture(context, {
      manifest: manifest([]),
      manifestText: '{"apiVersion":"security-transitions/v1","transitions":[],"transitions":[]}\n',
    }),
  );
});

test("sanitizes filesystem control characters in diagnostics", (context) => {
  const result = runFixture(context, {
    manifest: manifest([]),
    files: {
      "packages/contracts/src/bad\n\u001b[31m.ts": "const bypass = true;\n",
    },
  });
  assertRejected(result);
  assert.equal(result.stderr.includes("\u001b"), false);
  assert.equal(result.stderr.includes("\r"), false);
  assert.equal(result.stderr.split("\n").length, 2);
  assert.match(result.stderr, /\\u\{a\}.*\\u\{1b\}/u);
});
