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

/** @param {import("typescript").BindingName} name @param {Set<string>} names */
function deleteBindingNames(name, names) {
  if (ts.isIdentifier(name)) {
    names.delete(name.text);
  } else {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) {
        deleteBindingNames(element.name, names);
      }
    }
  }
}

/**
 * @param {import("typescript").Node} boundary
 * @param {ReadonlySet<string>} seeds
 * @param {boolean} [preserveShadows]
 */
function collectAuthorityNames(boundary, seeds, preserveShadows = false) {
  const names = new Set(seeds);
  /** @param {import("typescript").Node} node */
  function removeSafeShadows(node) {
    if (node !== boundary && ts.isFunctionLike(node) && hasNamedBoundary(node)) {
      return;
    }
    if (ts.isParameter(node)) {
      deleteBindingNames(node.name, names);
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer !== undefined &&
      !referencesAuthority(node.initializer, seeds)
    ) {
      deleteBindingNames(node.name, names);
    }
    ts.forEachChild(node, removeSafeShadows);
  }
  if (!preserveShadows) {
    removeSafeShadows(boundary);
  }
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
        propertyReadsAuthority(node.propertyName, names)
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

// Object literal key evaluation source:
// https://tc39.es/ecma262/2026/multipage/ecmascript-language-expressions.html#sec-runtime-semantics-propertydefinitionevaluation
// Type erasure source:
// https://www.typescriptlang.org/docs/handbook/2/basic-types.html#erased-types
// Type-only class members:
// https://www.typescriptlang.org/docs/handbook/2/classes.html#type-only-field-declarations
// https://www.typescriptlang.org/docs/handbook/2/classes.html#abstract-classes-and-members
// Runtime class definition source:
// https://tc39.es/ecma262/2026/multipage/ecmascript-language-functions-and-classes.html#sec-runtime-semantics-classdefinitionevaluation
/** @param {import("typescript").Node} node */
function isAmbientContext(node) {
  let current = node;
  while (!ts.isSourceFile(current)) {
    if (
      ts.canHaveModifiers(current) &&
      ts.getModifiers(current)?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)
    ) {
      return true;
    }
    current = current.parent;
  }
  return current.isDeclarationFile;
}

/** @param {import("typescript").Node} node */
function occursOnlyInErasedSyntax(node) {
  if (isAmbientContext(node)) {
    return true;
  }
  /** @type {import("typescript").Node} */
  let child = node;
  let current = node.parent;
  while (!ts.isSourceFile(current)) {
    if (
      ts.isExpressionWithTypeArguments(current) &&
      current.expression === child &&
      ts.isHeritageClause(current.parent) &&
      current.parent.token === ts.SyntaxKind.ExtendsKeyword &&
      ts.isClassLike(current.parent.parent)
    ) {
      return isAmbientContext(current.parent.parent);
    }
    if (ts.isComputedPropertyName(child) && "name" in current && current.name === child) {
      if (ts.isObjectLiteralElementLike(current) && ts.isObjectLiteralExpression(current.parent)) {
        return false;
      }
      if (ts.isClassElement(current) && ts.isClassLike(current.parent)) {
        return (
          isAmbientContext(current) ||
          (ts.getCombinedModifierFlags(current) & ts.ModifierFlags.Abstract) !== 0
        );
      }
    }
    if (
      ts.isDecorator(current) ||
      ((ts.isParameter(current) || ts.isPropertyDeclaration(current)) &&
        current.initializer === child)
    ) {
      return false;
    }
    if (
      ts.isTypeNode(current) ||
      ts.isTypeElement(current) ||
      ts.isTypeAliasDeclaration(current) ||
      ts.isInterfaceDeclaration(current) ||
      ts.isTypeParameterDeclaration(current)
    ) {
      return true;
    }
    if (ts.isStatement(current)) {
      return false;
    }
    child = current;
    current = current.parent;
  }
  return false;
}

/** @param {import("typescript").Identifier} node */
function isNonRuntimeIdentifier(node) {
  const parent = node.parent;
  return (
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
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && parent.propertyName === node) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    occursOnlyInErasedSyntax(node)
  );
}

// Runtime-transparent TypeScript expression source:
// https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#the-satisfies-operator
/** @param {import("typescript").PropertyName} property @param {ReadonlySet<string>} members */
function propertyReadsAuthority(property, members) {
  if (ts.isStringLiteralLike(property)) {
    return members.has(property.text);
  }
  if (ts.isComputedPropertyName(property)) {
    /** @type {import("typescript").Expression} */
    let expression = property.expression;
    while (
      ts.isParenthesizedExpression(expression) ||
      ts.isSatisfiesExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isTypeAssertionExpression(expression) ||
      ts.isNonNullExpression(expression)
    ) {
      expression = expression.expression;
    }
    if (ts.isStringLiteralLike(expression)) {
      return members.has(expression.text);
    }
    if (ts.isNumericLiteral(expression) || ts.isBigIntLiteral(expression)) {
      return false;
    }
    // A dynamic property key can resolve to an authority member at runtime.
    return true;
  }
  return referencesAuthority(property, members);
}

/** @param {import("typescript").BindingName} name @param {ReadonlySet<string>} members @returns {boolean} */
function bindingReadsAuthority(name, members) {
  if (ts.isIdentifier(name)) {
    return false;
  }
  for (const element of name.elements) {
    if (!ts.isBindingElement(element)) {
      continue;
    }
    const property =
      element.propertyName ??
      (ts.isObjectBindingPattern(name) &&
      element.dotDotDotToken === undefined &&
      ts.isIdentifier(element.name)
        ? element.name
        : undefined);
    if (
      (property !== undefined && propertyReadsAuthority(property, members)) ||
      bindingReadsAuthority(element.name, members)
    ) {
      return true;
    }
  }
  return false;
}

/** @param {import("typescript").Node} node @param {ReadonlySet<string>} members */
function isAuthorityMember(node, members) {
  return (
    ((ts.isPropertyAccessExpression(node) && members.has(node.name.text)) ||
      (ts.isElementAccessExpression(node) &&
        node.argumentExpression !== undefined &&
        ts.isStringLiteral(node.argumentExpression) &&
        members.has(node.argumentExpression.text))) &&
    !occursOnlyInErasedSyntax(node)
  );
}

/** @param {import("typescript").Node} node @param {ReadonlySet<string>} lexical @param {ReadonlySet<string>} members */
function referencesVisibleAuthority(node, lexical, members) {
  let found = false;
  /** @param {import("typescript").Node} child */
  function visit(child) {
    if (
      isAuthorityMember(child, members) ||
      (ts.isIdentifier(child) && lexical.has(child.text) && !isNonRuntimeIdentifier(child))
    ) {
      found = true;
    } else if (!found) {
      ts.forEachChild(child, visit);
    }
  }
  visit(node);
  return found;
}

// Scope semantics:
// https://tc39.es/ecma262/#sec-functiondeclarationinstantiation
// https://tc39.es/ecma262/#sec-blockdeclarationinstantiation
// https://tc39.es/ecma262/2026/multipage/ecmascript-language-statements-and-declarations.html#sec-runtime-semantics-catchclauseevaluation
// https://tc39.es/ecma262/2026/multipage/ecmascript-language-statements-and-declarations.html#sec-runtime-semantics-forin-div-ofheadevaluation
// https://tc39.es/ecma262/2026/multipage/ecmascript-language-statements-and-declarations.html#sec-runtime-semantics-forin-div-ofbodyevaluation
/** @param {import("typescript").Node} scope @param {ReadonlySet<string>} inherited @param {ReadonlySet<string>} members */
function namesVisibleInScope(scope, inherited, members) {
  const names = new Set(inherited);
  /** @param {import("typescript").VariableDeclaration} declaration */
  function removeHarmless(declaration) {
    if (
      (declaration.initializer === undefined ||
        !referencesVisibleAuthority(declaration.initializer, names, members)) &&
      !bindingReadsAuthority(declaration.name, members)
    ) {
      deleteBindingNames(declaration.name, names);
    }
  }
  if (ts.isFunctionLike(scope)) {
    for (const parameter of scope.parameters) {
      deleteBindingNames(parameter.name, names);
    }
  } else if (ts.isCatchClause(scope) && scope.variableDeclaration !== undefined) {
    removeHarmless(scope.variableDeclaration);
  } else if (
    (ts.isForStatement(scope) || ts.isForInStatement(scope) || ts.isForOfStatement(scope)) &&
    scope.initializer !== undefined &&
    ts.isVariableDeclarationList(scope.initializer)
  ) {
    for (const declaration of scope.initializer.declarations) {
      removeHarmless(declaration);
    }
  } else if (ts.isBlock(scope) || ts.isCaseBlock(scope)) {
    if (
      ts.isBlock(scope) &&
      ts.isFunctionLike(scope.parent) &&
      "body" in scope.parent &&
      scope.parent.body === scope
    ) {
      /** @param {import("typescript").Node} node */
      function removeFunctionVariables(node) {
        if (node !== scope && ts.isFunctionLike(node)) {
          return;
        }
        if (
          ts.isVariableDeclaration(node) &&
          ts.isVariableDeclarationList(node.parent) &&
          (node.parent.flags & ts.NodeFlags.BlockScoped) === 0
        ) {
          removeHarmless(node);
        }
        ts.forEachChild(node, removeFunctionVariables);
      }
      removeFunctionVariables(scope);
    }
    const statements = ts.isBlock(scope)
      ? scope.statements
      : scope.clauses.flatMap((clause) => [...clause.statements]);
    for (const statement of statements) {
      if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
        if (statement.name !== undefined) {
          names.delete(statement.name.text);
        }
      } else if (
        ts.isVariableStatement(statement) &&
        (statement.declarationList.flags & ts.NodeFlags.BlockScoped) !== 0
      ) {
        for (const declaration of statement.declarationList.declarations) {
          removeHarmless(declaration);
        }
      }
    }
  }
  return names;
}

/** @param {import("typescript").Node} boundary @param {ReadonlySet<string>} sinkSeeds @param {ReadonlySet<string>} [memberSeeds] */
function containsSink(boundary, sinkSeeds, memberSeeds = SINK_NAMES) {
  const sinkNames = collectAuthorityNames(boundary, sinkSeeds, true);
  let found = false;
  /** @param {import("typescript").Node} node @param {ReadonlySet<string>} visible */
  function visit(node, visible) {
    if (found || (node !== boundary && ts.isFunctionLike(node) && hasNamedBoundary(node))) {
      return;
    }
    const scoped = namesVisibleInScope(node, visible, memberSeeds);
    if (
      isAuthorityMember(node, memberSeeds) ||
      (ts.isIdentifier(node) && scoped.has(node.text) && !isNonRuntimeIdentifier(node))
    ) {
      found = true;
      return;
    }
    if (
      (ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
      ts.isVariableDeclarationList(node.initializer)
    ) {
      visit(node.initializer, scoped);
      visit(node.expression, visible);
      visit(node.statement, scoped);
      return;
    }
    ts.forEachChild(node, (child) => visit(child, scoped));
  }
  visit(boundary, sinkNames);
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
  const commentRanges = new Set();
  /** @type {ts.Node[]} */
  const nodes = [sourceFile];
  for (const node of nodes) {
    for (const range of [
      ...(ts.getLeadingCommentRanges(text, node.pos) ?? []),
      ...(ts.getTrailingCommentRanges(text, node.end) ?? []),
    ]) {
      commentRanges.add(`${range.pos}:${range.end}`);
    }
    nodes.push(...node.getChildren(sourceFile));
  }
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
    if (!commentRanges.has(`${scanner.getTokenPos()}:${scanner.getTextPos()}`)) {
      continue;
    }
    const comment = scanner.getTokenText();
    const line = sourceFile.getLineAndCharacterOfPosition(scanner.getTokenPos()).line;
    if (comment.includes("LLM-CONTRACT")) {
      if (
        token !== ts.SyntaxKind.SingleLineCommentTrivia ||
        !/^[ \t]*\/\/ LLM-CONTRACT:$/u.test(lines[line] ?? "")
      ) {
        fail(file.path, line + 1, "ContractCommentForm");
      }
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
  const unownedMembers = new Set([...SINK_NAMES, ...REGISTER_NAMES]);
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) ||
      ts.isExportDeclaration(statement) ||
      (ts.isFunctionLike(statement) && hasNamedBoundary(statement))
    ) {
      continue;
    }
    if (containsSink(statement, unownedSeeds, unownedMembers)) {
      const line =
        sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1;
      fail(file.path, line, "TopLevelAuthority");
    }
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
