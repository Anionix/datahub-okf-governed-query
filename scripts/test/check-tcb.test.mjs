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

/** @param {string} body @param {string} [parameters] */
function outerOnlySource(body, parameters = "") {
  return `${contract}function outer(${parameters}): void {\n${body}\n}\n`;
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

/** @type {readonly (readonly [string, string])[]} */
const jsxTextFixtures = [
  ["block marker", "/* LLM-CONTRACT: rendered example */"],
  ["line marker", "// LLM-CONTRACT: rendered example"],
  ["unterminated block shape", "/* LLM-CONTRACT: rendered example"],
  ["directive shape", "// @ts-ignore rendered example"],
];

for (const [name, text] of jsxTextFixtures) {
  test(`accepts marker-shaped JSX text: ${name}`, (context) => {
    assertAccepted(
      runFixture(context, {
        manifest: manifest([]),
        files: {
          "packages/contracts/src/example.tsx": `const view = <pre>${text}</pre>;\nvoid view;\n`,
        },
      }),
    );
  });
}

/** @type {readonly (readonly [string, string])[]} */
const jsxCommentRejections = [
  [
    "genuine TSX block comment",
    "const view = <pre />;\n/* LLM-CONTRACT: unregistered */\nvoid view;\n",
  ],
  [
    "JSX expression comment",
    "const view = <pre>{/* LLM-CONTRACT: unregistered */}</pre>;\nvoid view;\n",
  ],
  [
    "comment after line-shaped JSX text",
    "const view = <pre>// rendered text</pre>; /* LLM-CONTRACT: unregistered */\nvoid view;\n",
  ],
  [
    "comment after unterminated block-shaped JSX text",
    "const view = <pre>/* rendered text</pre>; /* LLM-CONTRACT: unregistered */\nvoid view;\n",
  ],
];

for (const [name, source] of jsxCommentRejections) {
  test(`rejects ${name}`, (context) => {
    const result = runFixture(context, {
      manifest: manifest([]),
      files: { "packages/contracts/src/example.tsx": source },
    });
    assertRejected(result);
    assert.match(result.stderr, /ContractCommentForm/u);
  });
}

test("rejects a directive after line-shaped JSX text", (context) => {
  const result = runFixture(context, {
    manifest: manifest([]),
    files: {
      "packages/contracts/src/example.tsx":
        "const view = <pre>// rendered text</pre>; // @ts-ignore\nvoid view;\n",
    },
  });
  assertRejected(result);
  assert.match(result.stderr, /TsIgnoreComment/u);
});

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
  { name: "runtime class heritage", source: "class Child extends execute {}\n" },
  {
    name: "runtime parenthesized class heritage",
    source: "class Child extends (execute) {}\n",
  },
  {
    name: "runtime call class heritage",
    source: "class Child extends execute() {}\n",
  },
  {
    name: "runtime nested class heritage",
    source: "class Child extends execute({ [writeFile]: 1 }) {}\n",
  },
  {
    name: "runtime computed getter",
    source: "class Child { get [writeFile](): number { return 1; } }\n",
  },
  {
    name: "runtime computed setter",
    source: "class Child { set [writeFile](value: number) { void value; } }\n",
  },
  {
    name: "runtime object computed getter",
    source: "const child = { get [writeFile](): number { return 1; } };\n",
  },
  {
    name: "runtime object computed setter",
    source: "const child = { set [writeFile](value: number) { void value; } };\n",
  },
  {
    name: "runtime getter decorator",
    source: "class Child { @decorate(writeFile) get value(): number { return 1; } }\n",
  },
  {
    name: "runtime setter decorator",
    source: "class Child { @decorate(writeFile) set value(next: number) { void next; } }\n",
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
  "function f(){try{}catch({message: details}){void details;}}",
  'function f(){try{}catch({["message"]: details}){void details;}}',
  "function f(){function writeFile(){}writeFile();}",
  "function f(v){switch(v){case 0:const writeFile=safe;void writeFile;}}",
  "function f(){const options={parse:false};void options;}",
  "namespace N { const writeFile = safe; void writeFile; }",
  "namespace N { void writeFile; if (flag) { var writeFile = safe; } }",
  "namespace N { class C { static { var writeFile = safe; void writeFile; } } }",
  "namespace N { function writeFile() {} writeFile(); }",
  "namespace N { import writeFile = Safe.writeFile; void writeFile; }",
  "const parse = safe, value = parse; void value;",
  "const parse = safe;\nconst value = parse;\nvoid value;",
  "export {}; void parse; if (flag) { var parse = safe; }",
  "export {}; function parse() {} parse();",
  "import type writeFile = Safe.value;",
  "const writeFile = safe; function helper() { writeFile(); }",
  "const registerTool = safe; function helper() { registerTool(); }",
  'import writeFile from "safe"; void writeFile;',
  'import * as writeFile from "safe"; void writeFile;',
  'import { safe as writeFile } from "safe"; void writeFile;',
  "const safe = 1; export { safe as writeFile };",
  "type writeFile = string; export type { writeFile };",
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
  {
    name: "renamed catch authority alias",
    source:
      "function boundary(): void {\n" +
      "  try {} catch ({ writeFile: run }) {\n" +
      '    run("x", "y", () => {});\n' +
      "  }\n" +
      "}\n",
  },
  {
    name: "string-key catch authority alias",
    source:
      "function boundary(): void {\n" +
      '  try {} catch ({ "writeFile": run }) {\n' +
      '    run("x", "y", () => {});\n' +
      "  }\n" +
      "}\n",
  },
  {
    name: "computed string-key catch authority alias",
    source:
      "function boundary(): void {\n" +
      '  try {} catch ({ ["writeFile"]: run }) {\n' +
      '    run("x", "y", () => {});\n' +
      "  }\n" +
      "}\n",
  },
  {
    name: "computed template-key catch authority alias",
    source:
      "function boundary(): void {\n" +
      "  try {} catch ({ [`writeFile`]: run }) {\n" +
      '    run("x", "y", () => {});\n' +
      "  }\n" +
      "}\n",
  },
  {
    name: "parenthesized computed catch authority alias",
    source:
      "function boundary(): void {\n" +
      '  try {} catch ({ [(("writeFile"))]: run }) {\n' +
      '    run("x", "y", () => {});\n' +
      "  }\n" +
      "}\n",
  },
  {
    name: "satisfies computed catch authority alias",
    source:
      "function boundary(): void {\n" +
      '  try {} catch ({ ["writeFile" satisfies string]: run }) {\n' +
      '    run("x", "y", () => {});\n' +
      "  }\n" +
      "}\n",
  },
  {
    name: "concatenated catch authority alias",
    source:
      "function boundary(): void {\n" +
      '  try {} catch ({ ["write" + "File"]: run }) {\n' +
      '    run("x", "y", () => {});\n' +
      "  }\n" +
      "}\n",
  },
  {
    name: "dynamic catch authority alias",
    source:
      "function boundary(key: string): void {\n" +
      "  try {} catch ({ [key]: run }) {\n" +
      '    run("x", "y", () => {});\n' +
      "  }\n" +
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

/** @type {readonly (readonly [string, string, string?])[]} */
const nestedAliasRejections = [
  ["direct alias", "const run = writeFile;\nfunction inner(): void { run(); }"],
  [
    "transitive alias",
    "const first = writeFile;\nconst second = first;\nfunction inner(): void { second(); }",
  ],
  ["later assignment", "let run = safe;\nrun = writeFile;\nfunction inner(): void { run(); }"],
  ["logical alias", "const run = writeFile || safe;\nfunction inner(): void { run(); }"],
  ["logical assignment", "let run = safe;\nrun ||= writeFile;\nfunction inner(): void { run(); }"],
  ["destructured property", "const { writeFile: run } = input;\nfunction inner(): void { run(); }"],
  [
    "object binding default",
    "const { value: run = writeFile } = input;\nfunction inner(): void { run(); }",
  ],
  ["array binding default", "const [run = writeFile] = input;\nfunction inner(): void { run(); }"],
  ["parameter default", "function inner(): void { run(); }", "run = writeFile"],
  [
    "catch binding",
    "try { safe(); } catch ({ writeFile: run }) { function inner(): void { run(); } }",
  ],
  ["for-of value", "for (const run of [writeFile]) { function inner(): void { run(); } }"],
  [
    "object carrier",
    "const holder = { run: writeFile };\nfunction inner(): void { holder.run(); }",
  ],
  [
    "property assignment",
    "const holder = {};\nholder.run = writeFile;\nfunction inner(): void { holder.run(); }",
  ],
  [
    "spread assignment",
    "let run = safe;\n({ ...run } = { cap: writeFile });\nfunction inner(): void { run(); }",
  ],
  ["opaque call result", "const run = identity(writeFile);\nfunction inner(): void { run(); }"],
  [
    "bind argument alias",
    "const bound = Function.prototype.call.bind(writeFile);\nconst run = bound;\nfunction inner(): void { run(); }",
  ],
  [
    "static element bind",
    'const run = writeFile["bind"](null);\nfunction inner(): void { run(); }',
  ],
];

for (const [name, body, parameters] of nestedAliasRejections) {
  test(`rejects nested ${name} without its own registration`, (context) => {
    const result = runFixture(context, {
      manifest: manifest([entry(sourcePath, "outer")]),
      files: { [sourcePath]: outerOnlySource(body, parameters) },
    });
    assertRejected(result);
    assert.match(result.stderr, /MissingRegistration/u);
  });
}

test("rejects a nested classic-script global before its var assignment", (context) => {
  for (const declaration of ["var writeFile = safe;", "if (flag) { var writeFile = safe; }"]) {
    const result = runFixture(context, {
      manifest: manifest([entry(sourcePath, "outer")]),
      files: {
        [sourcePath]:
          outerOnlySource("void digest;\nfunction inner(): void { writeFile(); }\ninner();") +
          `outer();\n${declaration}\n`,
      },
    });
    assertRejected(result);
    assert.match(result.stderr, /MissingRegistration/u);
  }
});

for (const declaration of [
  'import type writeFile from "./safe.js";\n',
  'import type * as writeFile from "./safe.js";\n',
]) {
  test("rejects a nested runtime use behind a type-only import", (context) => {
    const result = runFixture(context, {
      manifest: manifest([entry(sourcePath, "outer")]),
      files: {
        [sourcePath]:
          declaration + outerOnlySource("void digest;\nfunction inner(): void { writeFile(); }"),
      },
    });
    assertRejected(result);
    assert.match(result.stderr, /MissingRegistration/u);
  });
}

test("rejects a nested authority carried through this", (context) => {
  const result = runFixture(context, {
    manifest: manifest([entry(sourcePath, "outer")]),
    files: {
      [sourcePath]:
        "class Holder {\n" +
        "  run = safe;\n" +
        contract +
        "  outer(): void {\n" +
        "    this.run = writeFile;\n" +
        "  }\n" +
        "  inner(): void { this.run(); }\n" +
        "}\n",
    },
  });
  assertRejected(result);
  assert.match(result.stderr, /MissingRegistration/u);
});

test("rejects a registerTool alias captured by a nested boundary", (context) => {
  const result = runFixture(context, {
    manifest: manifest([]),
    files: {
      [sourcePath]:
        "function outer(): void {\n" +
        "  const register = server.registerTool.bind(server);\n" +
        '  function inner(): void { register("query", {}, handler); }\n' +
        "}\n",
    },
  });
  assertRejected(result);
  assert.match(result.stderr, /CallExpression/u);
});

/** @type {readonly (readonly [string, string])[]} */
const nestedAliasControls = [
  ["lexical shadow", "const run = writeFile;\nfunction inner(): void { const run = safe; run(); }"],
  ["parameter shadow", "const run = writeFile;\nfunction inner(run: Safe): void { run(); }"],
  ["TDZ shadow", "const run = writeFile;\nfunction inner(): void { void run; const run = safe; }"],
  ["var hoist shadow", "const run = writeFile;\nfunction inner(): void { run(); var run = safe; }"],
  ["for-in key", "for (const run in writeFile) { function inner(): void { run.trim(); } }"],
  ["authority call result", "const run = writeFile();\nfunction inner(): void { void run; }"],
  [
    "namespace runtime shadow",
    "void writeFile;\nnamespace N { const writeFile = safe; function inner(): void { writeFile(); } }",
  ],
];

for (const [name, body] of nestedAliasControls) {
  test(`accepts nested ${name}`, (context) => {
    assertAccepted(
      runFixture(context, {
        manifest: manifest([entry(sourcePath, "outer")]),
        files: { [sourcePath]: outerOnlySource(body) },
      }),
    );
  });
}

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
    name: "classic-script var before safe assignment",
    source: 'writeFile("x", "y", () => {});\nvar writeFile = safe;\n',
  },
  {
    name: "type-only imported shadow runtime use",
    source: 'import { type safe as writeFile } from "safe";\n' + 'writeFile("x", "y", () => {});\n',
  },
  {
    name: "local authority export",
    source: 'import { writeFile } from "node:fs";\nexport { writeFile };\n',
  },
  {
    name: "aliased local authority export",
    source: 'import { writeFile } from "node:fs";\nexport { writeFile as persist };\n',
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
  "interface Child extends execute {}\n",
  "class Child implements execute {}\n",
  "interface Child extends authority.execute {}\n",
  "class Child implements authority.execute {}\n",
  "declare class Child extends execute {}\n",
  "abstract class Child { abstract get [writeFile](): number }\n",
  "class Child { declare [writeFile]: number }\n",
  "declare class Child extends (execute) {}\n",
  "abstract class Child { abstract get [(writeFile)](): number }\n",
  "class Child { declare [(writeFile)]: number }\n",
  "declare class Base {}\ndeclare function execute(): typeof Base;\ndeclare class Child extends execute() {}\n",
  "declare class Base {}\ndeclare function execute(value: unknown): typeof Base;\ndeclare const writeFile: string;\ndeclare class Child extends execute({ [writeFile]: 1 }) {}\n",
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

test("detects imported namespace member authority use", (context) => {
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

test("detects direct authority use inside a namespace", (context) => {
  const result = runFixture(context, {
    manifest: manifest([]),
    files: { [sourcePath]: "namespace N { writeFile(); }\n" },
  });
  assertRejected(result);
  assert.match(result.stderr, /TopLevelAuthority/u);
});

test("detects authority use behind an erased namespace declaration", (context) => {
  const result = runFixture(context, {
    manifest: manifest([]),
    files: {
      [sourcePath]:
        'import { writeFile } from "node:fs";\n' +
        "namespace N {\n" +
        '  declare const writeFile: typeof import("node:fs").writeFile;\n' +
        '  writeFile("x", "y", () => {});\n' +
        "}\n",
    },
  });
  assertRejected(result);
  assert.match(result.stderr, /TopLevelAuthority/u);
});

/** @type {readonly (readonly [string, string])[]} */
const erasedNamespaceShadowFixtures = [
  ["type-only import-equals", "  import type writeFile = Safe.Type;\n"],
  ["bodyless overload", "  function writeFile(): void;\n"],
];

for (const [name, declaration] of erasedNamespaceShadowFixtures) {
  test(`detects authority behind a namespace ${name}`, (context) => {
    const result = runFixture(context, {
      manifest: manifest([]),
      files: {
        [sourcePath]:
          'import { writeFile } from "node:fs";\n' +
          "namespace N {\n" +
          declaration +
          '  writeFile("x", "y", () => {});\n' +
          "}\n",
      },
    });
    assertRejected(result);
    assert.match(result.stderr, /TopLevelAuthority/u);
  });
}

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
