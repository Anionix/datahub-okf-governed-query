/// <reference types="node" />

import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { posix, relative, resolve, sep } from "node:path";
import ts from "typescript";

// Package identity source: official @typescript/typescript6 6.0.2 npm tarball.
// https://registry.npmjs.org/@typescript/typescript6/-/typescript6-6.0.2.tgz
// API usage source: bare "typescript" resolves to its stable 6.0.3 Compiler API.
// https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API

/** @type {readonly RootName[]} */
const ROOTS = ["contracts", "compiler", "context", "executor", "integration"];
/** @type {Readonly<Record<RootName, readonly string[]>>} */
const ROOT_PATHS = {
  contracts: ["packages/contracts/src"],
  compiler: ["packages/policy-compiler/src"],
  context: ["apps/context-mcp/src"],
  executor: ["apps/query-executor/src"],
  integration: ["infra/datahub", "scripts"],
};
const ENTRY_KEYS = ["accepts", "emits", "failure", "invariant", "path", "root", "symbol"];
const MANIFEST_KEYS = ["apiVersion", "transitions"];
const CONTRACT_LABELS = ["LLM-CONTRACT:", "Accepts:", "Emits:", "Failure:", "Invariant:"];
const TS_EXTENSIONS = new Set([".cts", ".mts", ".ts", ".tsx"]);
const JS_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs"]);
const REGISTER_NAMES = new Set(["registerTool"]);
const SINK_NAMES = new Set([
  "appendFile",
  "appendFileSync",
  "brand",
  "copyFile",
  "createHash",
  "createSourceFile",
  "digest",
  "exec",
  "execFile",
  "execFileSync",
  "execute",
  "fork",
  "mkdir",
  "mkdirSync",
  "parse",
  "parseAsync",
  "query",
  "rename",
  "renameSync",
  "rm",
  "safeParse",
  "spawn",
  "spawnSync",
  "unlink",
  "writeFile",
  "writeFileSync",
]);

/**
 * @typedef {"contracts" | "compiler" | "context" | "executor" | "integration"} RootName
 * @typedef {{
 *   readonly root: RootName, readonly path: string, readonly symbol: string,
 *   readonly accepts: string, readonly emits: string, readonly failure: string,
 *   readonly invariant: string
 * }} Transition
 * @typedef {{
 *   readonly apiVersion: "security-transitions/v1",
 *   readonly transitions: readonly Transition[]
 * }} Manifest
 * @typedef {{
 *   readonly root: RootName, readonly path: string, readonly absolute: string
 * }} GovernedFile
 * @typedef {{
 *   readonly symbol: string, readonly node: import("typescript").Node,
 *   readonly required: boolean
 * }} Candidate
 * @typedef {{
 *   readonly root: RootName, readonly path: string,
 *   readonly sourceFile: import("typescript").SourceFile,
 *   readonly lines: readonly string[], readonly headers: readonly number[],
 *   readonly candidates: readonly Candidate[]
 * }} Inspection
 */

class TcbError extends Error {
  /** @param {string} file @param {number} line @param {string} kind */
  constructor(file, line, kind) {
    super(kind);
    this.file = file;
    this.line = line;
    this.kind = kind;
  }
}

/** @param {string} file @param {number} line @param {string} kind @returns {never} */
function fail(file, line, kind) {
  throw new TcbError(file, line, kind);
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

/** @param {unknown} value @returns {value is RootName} */
function isRoot(value) {
  return (
    value === "contracts" ||
    value === "compiler" ||
    value === "context" ||
    value === "executor" ||
    value === "integration"
  );
}

/** @param {readonly string[]} actual @param {readonly string[]} expected */
function sameKeys(actual, expected) {
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

/** @param {string} left @param {string} right */
function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

/** @param {Transition} left @param {Transition} right */
function compareTransitions(left, right) {
  return (
    compareUtf8(left.root, right.root) ||
    compareUtf8(left.path, right.path) ||
    compareUtf8(left.symbol, right.symbol)
  );
}

/** @param {RootName} root @param {string} path */
function pathBelongsToRoot(root, path) {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    [...path].some((character) => {
      const code = character.codePointAt(0);
      return code === undefined || code < 32 || code === 127;
    }) ||
    posix.normalize(path) !== path
  ) {
    return false;
  }
  if (root === "integration") {
    return (
      path.endsWith(".mjs") &&
      ((path.startsWith("infra/datahub/") && !path.includes("/test/")) ||
        (path.startsWith("scripts/") && !path.split("/").includes("test")))
    );
  }
  const base = ROOT_PATHS[root][0];
  return (
    base !== undefined &&
    path.startsWith(`${base}/`) &&
    TS_EXTENSIONS.has(posix.extname(path).toLowerCase())
  );
}

/** @param {unknown} raw @param {string} file @returns {Transition} */
function parseTransition(raw, file) {
  if (!isRecord(raw) || !sameKeys(Object.keys(raw).sort(compareUtf8), ENTRY_KEYS)) {
    fail(file, 1, "ManifestEntrySchema");
  }
  const { accepts, emits, failure, invariant, path, root, symbol } = raw;
  const clauses = [accepts, emits, failure, invariant];
  if (
    !isRoot(root) ||
    typeof path !== "string" ||
    typeof symbol !== "string" ||
    symbol.length === 0 ||
    [...symbol].some((character) => {
      const code = character.codePointAt(0);
      return code === undefined || code < 32 || code === 127;
    }) ||
    !clauses.every((clause) => typeof clause === "string" && /^[\x20-\x7e]+$/u.test(clause))
  ) {
    fail(file, 1, "ManifestEntrySchema");
  }
  if (!pathBelongsToRoot(root, path)) {
    fail(file, 1, "ManifestPath");
  }
  if (
    typeof accepts !== "string" ||
    typeof emits !== "string" ||
    typeof failure !== "string" ||
    typeof invariant !== "string"
  ) {
    fail(file, 1, "ManifestEntrySchema");
  }
  return { root, path, symbol, accepts, emits, failure, invariant };
}

/**
 * @param {string} text
 * @param {string} file
 * @returns {Manifest}
 */
// LLM-CONTRACT:
// Accepts: raw manifest text from the selected repository
// Emits: a closed sorted transition manifest
// Failure: rejects malformed or noncanonical manifest state
// Invariant: unvalidated fields never reach source inspection
function parseManifest(text, file) {
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    fail(file, 1, "ManifestJson");
  }
  const jsonSource = ts.parseJsonText(file, text);
  /** @param {import("typescript").Node} node */
  function rejectDuplicateKeys(node) {
    if (ts.isObjectLiteralExpression(node)) {
      const keys = new Set();
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name)) {
          fail(file, 1, "ManifestJsonShape");
        }
        if (keys.has(property.name.text)) {
          fail(file, 1, "ManifestDuplicateKey");
        }
        keys.add(property.name.text);
      }
    }
    ts.forEachChild(node, rejectDuplicateKeys);
  }
  rejectDuplicateKeys(jsonSource);
  if (!isRecord(raw) || !sameKeys(Object.keys(raw).sort(compareUtf8), MANIFEST_KEYS)) {
    fail(file, 1, "ManifestSchema");
  }
  const { apiVersion, transitions: rawTransitions } = raw;
  if (apiVersion !== "security-transitions/v1" || !Array.isArray(rawTransitions)) {
    fail(file, 1, "ManifestSchema");
  }

  /** @type {Transition[]} */
  const transitions = [];
  const pairs = new Set();
  for (const value of rawTransitions) {
    const transition = parseTransition(value, file);
    const pair = `${transition.path}\0${transition.symbol}`;
    if (pairs.has(pair)) {
      fail(file, 1, "ManifestDuplicate");
    }
    pairs.add(pair);
    transitions.push(transition);
  }
  for (let index = 1; index < transitions.length; index += 1) {
    const previous = transitions[index - 1];
    const current = transitions[index];
    if (
      previous === undefined ||
      current === undefined ||
      compareTransitions(previous, current) >= 0
    ) {
      fail(file, 1, "ManifestOrder");
    }
  }
  return { apiVersion: "security-transitions/v1", transitions };
}

/** @param {string} path */
function repositoryPath(path) {
  return relative(process.cwd(), path).split(sep).join("/");
}

/** @param {RootName} root @param {string} directory @param {GovernedFile[]} files */
function walkRoot(root, directory, files) {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    compareUtf8(left.name, right.name),
  );
  for (const entry of entries) {
    const absolute = resolve(directory, entry.name);
    const path = repositoryPath(absolute);
    if (
      path.includes("\\") ||
      [...path].some((character) => {
        const code = character.codePointAt(0);
        return code === undefined || code < 32 || code === 127;
      })
    ) {
      fail(path, 1, "SourcePath");
    }
    if (entry.isSymbolicLink()) {
      fail(path, 1, "SourceSymlink");
    }
    if (entry.isDirectory()) {
      walkRoot(root, absolute, files);
    } else if (entry.isFile()) {
      const extension = posix.extname(path).toLowerCase();
      if (root !== "integration" && JS_EXTENSIONS.has(extension)) {
        fail(path, 1, "SourceLanguage");
      }
      if (pathBelongsToRoot(root, path)) {
        files.push({ root, path, absolute });
      }
    }
  }
}

/** @param {readonly RootName[]} roots @returns {readonly GovernedFile[]} */
function discoverFiles(roots) {
  /** @type {GovernedFile[]} */
  const files = [];
  for (const root of roots) {
    for (const base of ROOT_PATHS[root]) {
      const absolute = resolve(base);
      if (!existsSync(absolute)) {
        continue;
      }
      if (!lstatSync(absolute).isDirectory()) {
        fail(base, 1, "RootKind");
      }
      walkRoot(root, absolute, files);
    }
  }
  return files.sort((left, right) => compareUtf8(left.path, right.path));
}

/** @param {import("typescript").Node} node */
function hasExportModifier(node) {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
        false)
    : false;
}

/** @param {import("typescript").Node} node */
function hasDefaultModifier(node) {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ??
        false)
    : false;
}

/** @param {import("typescript").CallExpression} call */
function calledName(call) {
  const expression = call.expression;
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression !== undefined &&
    ts.isStringLiteral(expression.argumentExpression)
  ) {
    return expression.argumentExpression.text;
  }
  return undefined;
}

/** @param {import("typescript").Node} node @param {ReadonlySet<string>} names */
function referencesAuthority(node, names) {
  let found = false;
  /** @param {import("typescript").Node} node */
  function visit(node) {
    if (
      (ts.isIdentifier(node) && names.has(node.text)) ||
      (ts.isElementAccessExpression(node) &&
        node.argumentExpression !== undefined &&
        ts.isStringLiteral(node.argumentExpression) &&
        names.has(node.argumentExpression.text))
    ) {
      found = true;
      return;
    }
    if (!found) {
      ts.forEachChild(node, visit);
    }
  }
  visit(node);
  return found;
}

/** @param {import("typescript").Node} node @param {Set<string>} names */
function addIdentifierNames(node, names) {
  let changed = false;
  /** @param {import("typescript").Node} child */
  function visit(child) {
    if (ts.isIdentifier(child) && !names.has(child.text)) {
      names.add(child.text);
      changed = true;
    }
    ts.forEachChild(child, visit);
  }
  visit(node);
  return changed;
}

/** @param {import("typescript").Node} node @param {Set<string>} names */
function deleteIdentifierNames(node, names) {
  /** @param {import("typescript").Node} child */
  function visit(child) {
    if (ts.isIdentifier(child)) {
      names.delete(child.text);
    }
    ts.forEachChild(child, visit);
  }
  visit(node);
}

/**
 * @param {import("typescript").Node} boundary
 * @param {ReadonlySet<string>} seeds
 */
function collectAuthorityNames(boundary, seeds) {
  const names = new Set(seeds);
  /** @param {import("typescript").Node} node */
  function removeSafeShadows(node) {
    if (node !== boundary && ts.isFunctionLike(node) && hasNamedBoundary(node)) {
      return;
    }
    if (ts.isParameter(node)) {
      deleteIdentifierNames(node.name, names);
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer !== undefined &&
      !referencesAuthority(node.initializer, seeds)
    ) {
      deleteIdentifierNames(node.name, names);
    }
    ts.forEachChild(node, removeSafeShadows);
  }
  removeSafeShadows(boundary);
  for (let changed = true; changed; ) {
    changed = false;
    /** @param {import("typescript").Node} node */
    function visit(node) {
      if (node !== boundary && ts.isFunctionLike(node) && hasNamedBoundary(node)) {
        return;
      }
      if (ts.isImportSpecifier(node)) {
        const source = (node.propertyName ?? node.name).text;
        if (names.has(source) && !names.has(node.name.text)) {
          names.add(node.name.text);
          changed = true;
        }
      } else if (
        ts.isVariableDeclaration(node) &&
        node.initializer !== undefined &&
        !ts.isArrowFunction(node.initializer) &&
        !ts.isFunctionExpression(node.initializer) &&
        referencesAuthority(node.initializer, names)
      ) {
        changed = addIdentifierNames(node.name, names) || changed;
      } else if (
        ts.isBindingElement(node) &&
        node.propertyName !== undefined &&
        referencesAuthority(node.propertyName, names)
      ) {
        changed = addIdentifierNames(node.name, names) || changed;
      } else if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        referencesAuthority(node.right, names)
      ) {
        changed = addIdentifierNames(node.left, names) || changed;
      }
      ts.forEachChild(node, visit);
    }
    visit(boundary);
  }
  return names;
}

/**
 * @param {import("typescript").SourceFile} sourceFile
 * @param {ReadonlySet<string>} seeds
 */
function collectImportedNames(sourceFile, seeds) {
  const names = new Set(seeds);
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      statement.importClause === undefined ||
      statement.importClause.isTypeOnly
    ) {
      continue;
    }
    const bindings = statement.importClause.namedBindings;
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const specifier of bindings.elements) {
        if (!specifier.isTypeOnly && names.has((specifier.propertyName ?? specifier.name).text)) {
          names.add(specifier.name.text);
        }
      }
    }
  }
  return names;
}

/** @param {import("typescript").SourceFile} sourceFile */
function collectExportedNames(sourceFile) {
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const specifier of statement.exportClause.elements) {
        names.add((specifier.propertyName ?? specifier.name).text);
      }
    } else if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
      names.add(statement.expression.text);
    }
  }
  return names;
}

/** @param {import("typescript").SignatureDeclaration} node */
function hasNamedBoundary(node) {
  if (
    (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) &&
    node.name !== undefined
  ) {
    return true;
  }
  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
    return true;
  }
  const parent = node.parent;
  return (
    (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) ||
    (ts.isPropertyDeclaration(parent) && ts.isIdentifier(parent.name))
  );
}

/** @param {import("typescript").Identifier} node */
function isNonRuntimeIdentifier(node) {
  const parent = node.parent;
  if (
    ((ts.isParameter(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isBindingElement(parent) ||
      ts.isImportSpecifier(parent)) &&
      parent.name === node) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent)
  ) {
    return true;
  }
  let current = parent;
  while (!ts.isSourceFile(current) && !ts.isStatement(current) && !ts.isExpression(current)) {
    if (ts.isTypeNode(current)) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/** @param {import("typescript").Node} boundary @param {ReadonlySet<string>} sinkSeeds */
function containsSink(boundary, sinkSeeds) {
  const sinkNames = collectAuthorityNames(boundary, sinkSeeds);
  let found = false;
  /** @param {import("typescript").Node} node */
  function visit(node) {
    if (found || (node !== boundary && ts.isFunctionLike(node) && hasNamedBoundary(node))) {
      return;
    }
    if (ts.isIdentifier(node) && sinkNames.has(node.text) && !isNonRuntimeIdentifier(node)) {
      found = true;
      return;
    }
    if (ts.isCallExpression(node)) {
      const name = calledName(node);
      if (name !== undefined && sinkNames.has(name)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(boundary);
  return found;
}

/**
 * @param {import("typescript").SourceFile} sourceFile
 * @param {ReadonlySet<string>} sinkNames
 * @returns {readonly Candidate[]}
 */
function collectCandidates(sourceFile, sinkNames) {
  const exportedNames = collectExportedNames(sourceFile);
  /** @type {Candidate[]} */
  const candidates = [];
  /** @param {import("typescript").Node} node */
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      candidates.push({
        symbol: node.name.text,
        node,
        required:
          hasExportModifier(node) ||
          (node.parent === sourceFile && exportedNames.has(node.name.text)) ||
          containsSink(node, sinkNames),
      });
    } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
      candidates.push({ symbol: node.name.text, node, required: containsSink(node, sinkNames) });
    } else if (
      ts.isPropertyDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      candidates.push({
        symbol: node.name.text,
        node,
        required: containsSink(node.initializer, sinkNames),
      });
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      const statement = node.parent.parent;
      candidates.push({
        symbol: node.name.text,
        node,
        required:
          (ts.isVariableStatement(statement) && hasExportModifier(statement)) ||
          (ts.isVariableStatement(statement) &&
            statement.parent === sourceFile &&
            exportedNames.has(node.name.text)) ||
          containsSink(node.initializer, sinkNames),
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return candidates;
}

/**
 * @param {GovernedFile} file
 * @returns {Inspection}
 */
// LLM-CONTRACT:
// Accepts: UTF-8 bytes from one selected governed source file
// Emits: declarations and contract comment locations from its AST
// Failure: rejects parse diagnostics forbidden syntax and ignored diagnostics
// Invariant: source text is parsed but never evaluated
function inspectFile(file) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(file.absolute));
  } catch {
    fail(file.path, 1, "SourceUtf8");
  }
  const sourceFile = ts.createSourceFile(file.path, text, ts.ScriptTarget.Latest, true);
  const transpilation = ts.transpileModule(text, {
    compilerOptions: {
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.Latest,
    },
    fileName: file.path,
    reportDiagnostics: true,
  });
  if (transpilation.diagnostics === undefined) {
    fail(file.path, 1, "ParseDiagnosticsUnavailable");
  }
  const parseDiagnostic = transpilation.diagnostics[0];
  if (parseDiagnostic !== undefined) {
    const line = sourceFile.getLineAndCharacterOfPosition(parseDiagnostic.start ?? 0).line + 1;
    fail(file.path, line, "SourceParse");
  }
  const headers = [];
  const lines = text.split("\n");
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    text,
  );
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      token !== ts.SyntaxKind.SingleLineCommentTrivia &&
      token !== ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      continue;
    }
    const comment = scanner.getTokenText();
    const line = sourceFile.getLineAndCharacterOfPosition(scanner.getTokenPos()).line;
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia &&
      comment.includes("LLM-CONTRACT") &&
      /^[ \t]*\/\/.*LLM-CONTRACT/u.test(lines[line] ?? "")
    ) {
      headers.push(line);
    }
    if (/@ts-ignore\b/u.test(comment)) {
      fail(file.path, line + 1, "TsIgnoreComment");
    }
    if (/@ts-expect-error\b/u.test(comment)) {
      fail(file.path, line + 1, "TsExpectErrorComment");
    }
    if (/@ts-nocheck\b/u.test(comment)) {
      fail(file.path, line + 1, "TsNoCheckComment");
    }
    if (
      token === ts.SyntaxKind.MultiLineCommentTrivia &&
      /@type\s*\{/u.test(comment) &&
      /^\s*\(/u.test(text.slice(scanner.getTextPos()))
    ) {
      fail(file.path, line + 1, "JsDocAssertion");
    }
  }

  const jsDocRoots = new Set();
  /** @param {import("typescript").Node} node */
  function collectJsDoc(node) {
    for (const jsDoc of ts.getJSDocCommentsAndTags(node)) {
      jsDocRoots.add(jsDoc);
    }
    ts.forEachChild(node, collectJsDoc);
  }
  collectJsDoc(sourceFile);
  /** @param {import("typescript").Node} node */
  function rejectJsDocEscape(node) {
    if (node.kind === ts.SyntaxKind.AnyKeyword || node.kind === ts.SyntaxKind.JSDocAllType) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      fail(file.path, line, "JsDocTypeEscape");
    }
    ts.forEachChild(node, rejectJsDocEscape);
  }
  for (const jsDoc of jsDocRoots) {
    rejectJsDocEscape(jsDoc);
  }

  const sinkSeeds = collectImportedNames(sourceFile, SINK_NAMES);
  const registerSeeds = collectImportedNames(sourceFile, REGISTER_NAMES);

  /** @param {import("typescript").Node} node */
  function enclosingBoundary(node) {
    let current = node.parent;
    while (current !== sourceFile) {
      if (ts.isFunctionLike(current) && hasNamedBoundary(current)) {
        return current;
      }
      current = current.parent;
    }
    return sourceFile;
  }

  /** @param {import("typescript").Node} node */
  function rejectForbidden(node) {
    if (
      node.kind === ts.SyntaxKind.AnyKeyword ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isNonNullExpression(node)
    ) {
      const kind = ts.SyntaxKind[node.kind];
      fail(
        file.path,
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        typeof kind === "string" ? kind : "ForbiddenSyntax",
      );
    }
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    if (
      ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
        node.name === undefined &&
        hasDefaultModifier(node)) ||
      (ts.isExportAssignment(node) && !ts.isIdentifier(node.expression))
    ) {
      fail(file.path, line, "UntrackableExport");
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      !node.isTypeOnly &&
      (node.exportClause === undefined ||
        !ts.isNamedExports(node.exportClause) ||
        node.exportClause.elements.some((element) => !element.isTypeOnly))
    ) {
      fail(file.path, line, "CrossFileReExport");
    }
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (
        (ts.isElementAccessExpression(expression) &&
          (expression.argumentExpression === undefined ||
            !ts.isStringLiteral(expression.argumentExpression))) ||
        (!ts.isIdentifier(expression) &&
          !ts.isPropertyAccessExpression(expression) &&
          !ts.isElementAccessExpression(expression) &&
          expression.kind !== ts.SyntaxKind.SuperKeyword)
      ) {
        fail(file.path, line, "DynamicCall");
      }
      const name = calledName(node);
      const registerNames = collectAuthorityNames(enclosingBoundary(node), registerSeeds);
      if (name !== undefined && registerNames.has(name)) {
        fail(file.path, line, "CallExpression");
      }
    }
    ts.forEachChild(node, rejectForbidden);
  }
  rejectForbidden(sourceFile);

  const unownedSeeds = new Set([...sinkSeeds, ...registerSeeds]);
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) {
      continue;
    }
    const authorityNames = collectAuthorityNames(statement, unownedSeeds);
    /** @param {import("typescript").Node} node */
    function rejectUnowned(node) {
      if (ts.isFunctionLike(node) && hasNamedBoundary(node)) {
        return;
      }
      if (ts.isIdentifier(node) && authorityNames.has(node.text)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        fail(file.path, line, "TopLevelAuthority");
      }
      ts.forEachChild(node, rejectUnowned);
    }
    rejectUnowned(statement);
  }
  return {
    root: file.root,
    path: file.path,
    sourceFile,
    lines,
    headers,
    candidates: collectCandidates(sourceFile, sinkSeeds),
  };
}

/** @param {Transition} entry @param {Inspection} inspection @param {Candidate} candidate */
function verifyContract(entry, inspection, candidate) {
  const startLine = inspection.sourceFile.getLineAndCharacterOfPosition(
    candidate.node.getStart(inspection.sourceFile),
  ).line;
  const headerLine = startLine - CONTRACT_LABELS.length;
  if (headerLine < 0) {
    fail(inspection.path, startLine + 1, "ContractDetached");
  }
  const header = inspection.lines[headerLine];
  const match = header?.match(/^([ \t]*)\/\/ LLM-CONTRACT:$/u);
  if (match === null || match === undefined) {
    fail(inspection.path, startLine + 1, "ContractDetached");
  }
  const indent = match[1];
  if (indent === undefined) {
    fail(inspection.path, startLine + 1, "ContractShape");
  }
  const expected = [
    `${indent}// LLM-CONTRACT:`,
    `${indent}// Accepts: ${entry.accepts}`,
    `${indent}// Emits: ${entry.emits}`,
    `${indent}// Failure: ${entry.failure}`,
    `${indent}// Invariant: ${entry.invariant}`,
  ];
  for (let offset = 0; offset < expected.length; offset += 1) {
    if (inspection.lines[headerLine + offset] !== expected[offset]) {
      fail(inspection.path, headerLine + offset + 1, "ContractClause");
    }
  }
  return headerLine;
}

/**
 * @param {Manifest} manifest
 * @param {readonly RootName[]} roots
 */
// LLM-CONTRACT:
// Accepts: a closed manifest and selected fixed repository roots
// Emits: success only after exhaustive AST and contract verification
// Failure: rejects stale missing duplicate or forbidden transition state
// Invariant: the stable compiler API parses source without executing modules
function verifyRepository(manifest, roots) {
  const selected = new Set(roots);
  const entries = manifest.transitions.filter((entry) => selected.has(entry.root));
  const inspections = discoverFiles(roots).map(inspectFile);
  const byPath = new Map(inspections.map((inspection) => [inspection.path, inspection]));

  for (const entry of entries) {
    const inspection = byPath.get(entry.path);
    if (inspection === undefined || inspection.root !== entry.root) {
      fail(entry.path, 1, "StalePath");
    }
  }

  for (const inspection of inspections) {
    const fileEntries = entries.filter(
      (entry) => entry.root === inspection.root && entry.path === inspection.path,
    );
    const usedHeaders = new Set();
    for (const entry of fileEntries) {
      const matches = inspection.candidates.filter(
        (candidate) => candidate.symbol === entry.symbol,
      );
      if (matches.length !== 1) {
        fail(entry.path, 1, matches.length === 0 ? "StaleSymbol" : "AmbiguousSymbol");
      }
      const candidate = matches[0];
      if (candidate === undefined) {
        fail(entry.path, 1, "StaleSymbol");
      }
      const header = verifyContract(entry, inspection, candidate);
      if (usedHeaders.has(header)) {
        fail(entry.path, header + 1, "SharedContract");
      }
      usedHeaders.add(header);
    }
    for (const candidate of inspection.candidates) {
      if (candidate.required && !fileEntries.some((entry) => entry.symbol === candidate.symbol)) {
        const line =
          inspection.sourceFile.getLineAndCharacterOfPosition(
            candidate.node.getStart(inspection.sourceFile),
          ).line + 1;
        fail(inspection.path, line, "MissingRegistration");
      }
    }
    for (const header of inspection.headers) {
      if (!usedHeaders.has(header)) {
        fail(inspection.path, header + 1, "UnregisteredContract");
      }
    }
  }
}

/** @param {readonly string[]} arguments_ */
function parseArguments(arguments_) {
  let manifest;
  /** @type {readonly RootName[] | undefined} */
  let roots;
  for (let index = 0; index < arguments_.length; index += 1) {
    const option = arguments_[index];
    const value = arguments_[index + 1];
    if (option === "--manifest" && manifest === undefined && value !== undefined) {
      manifest = value;
      index += 1;
    } else if (option === "--roots" && roots === undefined && value !== undefined) {
      const requested = value.split(",");
      if (
        requested.length === 0 ||
        requested.some((root) => !isRoot(root)) ||
        new Set(requested).size !== requested.length
      ) {
        fail("cli", 1, "RootArgument");
      }
      roots = requested.filter(isRoot);
      index += 1;
    } else {
      fail("cli", 1, "Arguments");
    }
  }
  if (manifest === undefined) {
    fail("cli", 1, "Arguments");
  }
  return { manifest, roots };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  let manifestText;
  try {
    manifestText = readFileSync(resolve(options.manifest), "utf8");
  } catch {
    fail(options.manifest, 1, "ManifestRead");
  }
  const manifest = parseManifest(manifestText, options.manifest);
  const roots = options.roots ?? ROOTS;
  verifyRepository(manifest, roots);
}

/** @param {string} value */
function sanitizeDiagnostic(value) {
  let sanitized = "";
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code === undefined || code < 32 || (code >= 127 && code <= 159)) {
      sanitized += `\\u{${(code ?? 0).toString(16)}}`;
    } else {
      sanitized += character;
    }
  }
  return sanitized;
}

try {
  main();
} catch (error) {
  if (error instanceof TcbError) {
    process.stderr.write(
      `${sanitizeDiagnostic(error.file)}:${error.line}:${sanitizeDiagnostic(error.kind)}\n`,
    );
  } else {
    process.stderr.write("internal:1:InternalError\n");
  }
  process.exitCode = 1;
}
