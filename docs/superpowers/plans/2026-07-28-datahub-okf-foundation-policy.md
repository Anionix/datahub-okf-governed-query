# DataHub OKF Foundation and Policy Compiler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reproducible TypeScript workspace, closed shared contracts, deterministic digest primitives, and build-only OKF compiler that produce the executor's four reviewed runtime artifacts.

**Architecture:** A strict `@okf-datahub/contracts` package owns every value crossing a process boundary. A separate build-only `@okf-datahub/policy-compiler` accepts restricted OKF v0.2 Markdown/frontmatter plus reviewed JSON inputs, emits RFC 8785-compatible canonical JSON, and never ships in either runtime image.

**Tech Stack:** Node.js 24.18.0, pnpm 11.17.0, TypeScript 7.0.2 CLI, `@typescript/typescript6` package 6.0.2 with Compiler API identity 6.0.3, Zod 4.4.3, YAML 2.9.0, Vitest 4.1.10, fast-check 4.9.0, Biome 2.5.5, Nixpkgs `8623c4c20aa4ca2f5fb81510d2944066c3fb0d96`, uv 0.11.32, Lean 4.32.1

## Global Constraints

- Implement the approved design in `docs/superpowers/specs/2026-07-28-datahub-okf-governed-query-design.md`; widening its scope requires a new design review.
- Use one branch and one task per PR, target 150–220 changed lines excluding `LLM-CONTRACT` comments, and squash to the task's named commit.
- A numbered section with a mandatory `Delivery` table is an umbrella work
  package, not a PR. Each row is the actual task/branch/PR; a combined umbrella
  PR is forbidden. Unsliced numbered sections remain one task/PR.
- Run the configured `code-review` skill before every PR.
- Use exact dependency pins and a committed `pnpm-lock.yaml`, `flake.nix`, and `flake.lock`; runtime dependency resolution is forbidden.
- Keep all runtime objects closed: literal versions, strict Zod objects, unknown input, no coercion, no `any`, no type assertions, no non-null assertions, and no ignored TypeScript diagnostics.
- Accepted OKF source is repository
  `GoogleCloudPlatform/knowledge-catalog`, commit
  `3fcbb9f828c2f23d109c855ee403c3a4c81f3a96`, path `okf/SPEC.md`, raw
  SHA-256
  `5a3311d270bebb16d558010e75064f5b75323f284992641732b1c8097511f948`.
- Pin `mcp-server-datahub==0.6.0` at commit `9a6946daa7d30eb481c82dd8ee5e15ae6526a3c9`, DataHub Core v1.6.0 at commit `059a36c0b035a6057de00114ccac0ea9003d6bc2`, MCP 2025-11-25, `@modelcontextprotocol/sdk` 1.29.0, and PostgreSQL 18.4.
- Treat OKF `verified` as provenance only; runtime approval derives only from the protected review attestation.
- Convert `stale_after` to 00:00:00Z on that exact date because OKF v0.2 defines `today >= stale_after` as stale.
- Hash structured artifacts as SHA-256 over `ASCII-domain + NUL + UTF-8 canonical JSON`; hash OKF specification and policy source files as exact raw bytes.
- The compiler rejects aliases, anchors, merge keys, custom tags, duplicate keys, multiple documents, malformed Unicode, unknown policy-extension keys, and every configured size/depth/node limit violation.
- Policy material enters runtime images only as the four compiled JSON
  artifacts; neither runtime contains source OKF Markdown, a YAML parser,
  compiler, or build credentials. Package-manager absence is mandatory for the
  executor image; the context image separately proves uv/pip are absent and
  minimizes its inherited Python base utilities.
- Put an `LLM-CONTRACT` accepted-state/emitted-state/failure-state/invariant comment on every security-critical transition function.

---

## Dependency Order

This is Stage 1. Execute 1A–1C, 2A–2B, 3A–3B, 4A–4B, then 5A–5H in order. Every task branch starts from
`main` after the preceding task PR is merged; do not stack task branches.
Stage 2 context and executor work may start in parallel only after Task 5H has
exercised the merged protected policy-artifact workflow and immutable artifact
and attestation readback has succeeded.

---

## Key File Map (non-exhaustive)

For a mandatory `Delivery` table, each row's `Files` cell is exhaustive and
authoritative and the section-level Files list is only their union. For an
unsliced task, its Files list is exhaustive. This map only shows the paths most
useful for orientation.

```text
package.json                                  exact workspace versions and gates
pnpm-workspace.yaml                           workspace membership and root settings
pnpm-lock.yaml                                exact JavaScript dependency closure
tsconfig.json                                 workspace project references
tsconfig.base.json                            shared strict compiler policy
tsconfig.scripts.json                         strict checkJs for trusted scripts
biome.json                                    formatting and lint policy
flake.nix                                     cross-platform toolchain shell
flake.lock                                    immutable Nix input closure
nix/uv-0.11.32.nix                            exact uv override
nix/lean4-4.32.1.nix                          exact four-platform Lean package
scripts/check-toolchain.mjs                   exact version gate
security/security-transitions.v1.json         closed transition/comment registry
scripts/check-pnpm-settings.mjs               effective pnpm settings and lock gate
scripts/check-tcb.mjs                         AST and LLM-contract enforcement
security/security-shell-transitions.v1.json   closed shell authority registry
security/security-sql-transitions.v1.json     closed SQL authority registry
security/github-actions-uses.v1.json          immutable GitHub Action allowlist
scripts/check-security-shell.mjs              shell contract/digest gate
scripts/check-security-sql.mjs                SQL contract/digest gate
scripts/check-policy-workflow.mjs             immutable workflow action gate
.github/workflows/toolchain.yml               native four-system flake matrix
packages/contracts/src/literals.ts            fixed URNs, IDs, enums, bounds
packages/contracts/src/public.ts              two public MCP input/result unions
packages/contracts/src/mcp-json-schemas.ts     reviewed tools/list projections
packages/contracts/src/datahub-evidence.ts    sanitized DataHub evidence
packages/contracts/src/executor-protocol.ts   four internal UDS variants
packages/contracts/src/artifacts.ts           four runtime artifact schemas
packages/contracts/src/parse.ts               fixed-code unknown-input parsing
packages/contracts/src/canonical-json.ts      constrained RFC 8785 serializer
packages/contracts/src/digest.ts              domain-separated SHA-256
packages/contracts/src/index.ts               package export surface
packages/contracts/test/*.test.ts             contract and digest tests
packages/policy-compiler/src/restricted-okf.ts  restricted OKF concept loader
packages/policy-compiler/src/restricted-json.ts strict reviewed JSON loader
packages/policy-compiler/src/compile.ts        normalized IR/artifact compiler
packages/policy-compiler/src/cli.ts            deterministic build command
packages/policy-compiler/test/*.test.ts        rejection and reproducibility tests
policy/customer-orders.md                      reviewed OKF v0.2 concept
policy/resource-binding.source.v1.json         reviewed fixed identity mapping
policy/schema-contract.v1.json                 portable PostgreSQL contract
dist/policy/*.json                             canonical generated artifacts
```

### Task 1: Reproducible strict workspace

**Delivery:** This section is an umbrella only. Merge each row before starting
the next.

| Task | Branch | Files (exhaustive) | Commit |
|---|---|---|---|
| 1A — strict workspace and TypeScript TCB | `build/strict-typescript-workspace` | Create `.gitignore`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.json`, `tsconfig.base.json`, `tsconfig.scripts.json`, `biome.json`, `flake.nix`, `flake.lock`, `security/security-transitions.v1.json`, `scripts/check-pnpm-settings.mjs`, `scripts/check-tcb.mjs`, `scripts/test/check-pnpm-settings.test.mjs`, `scripts/test/check-tcb.test.mjs` | `build: establish strict typed workspace` |
| 1B — exact native toolchain and shell/SQL TCB | `build/pinned-native-toolchain` | Create `nix/uv-0.11.32.nix`, `nix/lean4-4.32.1.nix`, `scripts/check-toolchain.mjs`, `security/security-shell-transitions.v1.json`, `security/security-sql-transitions.v1.json`, `scripts/check-security-shell.mjs`, `scripts/check-security-sql.mjs`, `scripts/test/check-security-shell.test.mjs`, `scripts/test/check-security-sql.test.mjs`; modify `flake.nix`, `package.json`, `security/security-transitions.v1.json` | `build: pin the governed query toolchain` |
| 1C — immutable workflow matrix | `ci/pinned-toolchain-matrix` | Create `security/github-actions-uses.v1.json`, `scripts/check-policy-workflow.mjs`, `scripts/test/check-policy-workflow.test.mjs`, `.github/workflows/toolchain.yml`; modify `package.json`, `security/security-transitions.v1.json` | `ci: verify the four native toolchains` |

Row gates are incremental: 1A's `package.json` exposes only `tcb:check`,
`pnpm-settings:check`, format, TypeScript, and test commands and runs both
fixture suites; 1B adds toolchain/shell/SQL commands and runs native flake plus
shell/SQL fixtures; 1C adds `workflow:check`, runs the workflow fixtures, and
then enables the final aggregate `check` shown below. A row never invokes a
script owned by a later row.

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `pnpm-lock.yaml`
- Create: `tsconfig.json`
- Create: `tsconfig.base.json`
- Create: `tsconfig.scripts.json`
- Create: `biome.json`
- Create: `flake.nix`
- Create: `flake.lock`
- Create: `nix/uv-0.11.32.nix`
- Create: `nix/lean4-4.32.1.nix`
- Create: `scripts/check-toolchain.mjs`
- Create: `security/security-transitions.v1.json`
- Create: `scripts/check-pnpm-settings.mjs`
- Create: `scripts/check-tcb.mjs`
- Create: `scripts/test/check-pnpm-settings.test.mjs`
- Create: `scripts/test/check-tcb.test.mjs`
- Create: `security/security-shell-transitions.v1.json`
- Create: `security/security-sql-transitions.v1.json`
- Create: `security/github-actions-uses.v1.json`
- Create: `scripts/check-security-shell.mjs`
- Create: `scripts/check-security-sql.mjs`
- Create: `scripts/check-policy-workflow.mjs`
- Create: `scripts/test/check-security-shell.test.mjs`
- Create: `scripts/test/check-security-sql.test.mjs`
- Create: `scripts/test/check-policy-workflow.test.mjs`
- Create: `.github/workflows/toolchain.yml`
- Create: `.gitignore`

**Interfaces:**
- Consumes: Nixpkgs commit
  `8623c4c20aa4ca2f5fb81510d2944066c3fb0d96` and only fixed-output
  exceptions declared below.
- Produces: `pnpm check`, `pnpm test`, `pnpm pnpm-settings:check`, and `pnpm toolchain:check`; workspace packages inherit `tsconfig.base.json`.

- [ ] **Step 1 [1B only]: Write the exact version gate**

```js
// scripts/check-toolchain.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const read = (command, args) =>
  execFileSync(command, args, { encoding: "utf8" }).trim();

assert.equal(process.versions.node, "24.18.0");
assert.equal(read("pnpm", ["--version"]), "11.17.0");
assert.equal(read("uv", ["--version"]).split(" ").slice(0, 2).join(" "), "uv 0.11.32");
assert.equal(
  read("lean", ["--version"]).split(" ").slice(0, 3).join(" "),
  "Lean (version 4.32.1,",
);
assert.equal(read("postgres", ["--version"]), "postgres (PostgreSQL) 18.4");
console.log("toolchain versions verified");
```

- [ ] **Step 2 [1B only]: Run it before the Nix shell and verify the expected failure**

Run: `node scripts/check-toolchain.mjs`

Expected: FAIL if any host tool differs; this proves the gate is active rather than silently accepting the host.

- [ ] **Step 3 [1A → 1B → 1C]: Add only the current row's definitions**

1A creates the workspace package with exactly these scripts; it has no
toolchain, shell, SQL, or workflow script:

```json
{
  "name": "datahub-okf-governed-query",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.17.0",
  "engines": {"node": "24.18.0", "pnpm": "11.17.0"},
  "scripts": {
    "tcb:check": "node scripts/check-tcb.mjs --manifest security/security-transitions.v1.json",
    "pnpm-settings:check": "node scripts/check-pnpm-settings.mjs",
    "format": "biome format --write .",
    "scripts:check": "tsc -p tsconfig.scripts.json --noEmit --pretty false",
    "check": "pnpm tcb:check && pnpm pnpm-settings:check && biome check . && pnpm scripts:check",
    "test": "pnpm -r --if-present run test"
  },
  "devDependencies": {
    "@biomejs/biome": "2.5.5",
    "@types/node": "24.13.3",
    "@typescript/native": "npm:typescript@7.0.2",
    "@vitest/coverage-v8": "4.1.10",
    "fast-check": "4.9.0",
    "typescript": "npm:@typescript/typescript6@6.0.2",
    "vitest": "4.1.10"
  }
}
```

The alias split is mandatory. `@typescript/native` owns the exact TypeScript
7.0.2 `tsc` CLI, while imports from `typescript` resolve to the exact stable
`@typescript/typescript6` compatibility package version 6.0.2. That package's
embedded Compiler API and `tsc6` self-identify as 6.0.3. The lockfile must
preserve both package identities and versions, and the fixture suite must assert
package version 6.0.2, API version 6.0.3, and a callable `createSourceFile`.
The primary artifact is the
[official npm tarball](https://registry.npmjs.org/@typescript/typescript6/-/typescript6-6.0.2.tgz)
with integrity
`sha512-mbCddXd+jm7hfx7w2YU64/Av4/NqqeG3GoRZgxPcgoTxYjhrcfJRw9ULch71SS4G+Q3bOXFhRvPqjguN0Hyp5w==`;
its package manifest and exported API identity are checked from installed bytes.
TypeScript 7.0 does not ship a stable programmatic API, so the checker may
import its API only from bare `typescript`; all `@typescript/native` and
`typescript/unstable/*` imports are forbidden.
[Microsoft's TypeScript 7.0 release notes](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
are the authority for this side-by-side compatibility boundary.

After 1A merges, 1B adds exactly `toolchain:check`, `shell-tcb:check`, and
`sql-tcb:check`; its aggregate is:

```json
{
  "check": "pnpm tcb:check && pnpm pnpm-settings:check && pnpm shell-tcb:check && pnpm sql-tcb:check && biome check . && pnpm scripts:check",
  "shell-tcb:check": "node scripts/check-security-shell.mjs security/security-shell-transitions.v1.json",
  "sql-tcb:check": "node scripts/check-security-sql.mjs security/security-sql-transitions.v1.json",
  "toolchain:check": "node scripts/check-toolchain.mjs"
}
```

After 1B merges, 1C adds exactly `workflow:check` and changes only the
aggregate to:

```json
{
  "check": "pnpm tcb:check && pnpm pnpm-settings:check && pnpm shell-tcb:check && pnpm sql-tcb:check && pnpm workflow:check && biome check . && pnpm scripts:check",
  "workflow:check": "node scripts/check-policy-workflow.mjs security/github-actions-uses.v1.json"
}
```

Those objects are exact `scripts` additions/replacements, not standalone
package files. 1A owns the workspace JSON/TypeScript/Biome definitions and a
minimal flake exposing only the pinned Node/pnpm shell from the exact Nixpkgs
commit below. 1B extends that already-locked flake with the native-tool,
shell, and SQL definitions; 1C alone owns the workflow allowlist/checker and
native workflow matrix.

Tasks 1A through 1C do not run `tsc -b`: their root solution has no project
reference, and both pinned TypeScript CLIs reject its intentional `files: []`
with `TS18002`. `scripts:check` remains mandatory. Task 2A adds `tsc -b` to the
aggregate in the same PR that adds the first project reference. The
[TypeScript native support table](https://github.com/microsoft/typescript-go/blob/main/README.md)
is the authority that build mode and project references themselves are
supported.

`security/security-transitions.v1.json` is a strict object containing only
`apiVersion: "security-transitions/v1"` and a `transitions` array. Each entry
contains only `root`, repository-relative `path`, exact AST symbol name, and the
four non-empty ASCII strings `accepts`, `emits`, `failure`, and `invariant`.
Entries are sorted by raw UTF-8 `(root,path,symbol)`. The registry is
incremental and exhaustive for code present in the reviewed commit;
planned-but-absent symbols are forbidden. Every PR that adds, removes, renames,
or moves a security transition updates this file in the same PR.

The fixed roots are `contracts`, `compiler`, `context`, `executor`, and
`integration`. The first four map to their exact `src` directories.
`integration` maps only to reviewed `.mjs` transition owners under
`infra/datahub` and `scripts`; tests, generated files, vendored Compose, and
arbitrary repository JavaScript are outside that root. Duplicate
`(path,symbol)` pairs, paths outside a fixed root, unknown keys, or unregistered
`LLM-CONTRACT` comments are invalid.

`scripts/check-tcb.mjs` scans all fixed roots that exist when `--roots` is
omitted; `--roots` is allowed only for focused tests and accepts only those
five names. For every registry entry in a selected root, the stable Compiler API
identity 6.0.3 imported from the package-6.0.2 compatibility alias must resolve
exactly one declaration or class method
and find this immediately adjacent comment with byte-equal clauses:

```ts
// LLM-CONTRACT:
// Accepts: <registry accepts>
// Emits: <registry emits>
// Failure: <registry failure>
// Invariant: <registry invariant>
```

For each selected root, every exported named function and every named function
containing a branding, parsing, hashing, live-review, filesystem-write,
atomic-rename, process-launch, secret-provisioning, database-execution, stack
startup/teardown, or release-decision sink must have exactly one registry entry.
Missing/stale symbols, moved paths, duplicate comments, changed clause labels,
or comments detached by another statement fail the gate. The same AST pass
rejects
`AnyKeyword`, `AsExpression`, `TypeAssertionExpression`,
`NonNullExpression`, `@ts-ignore`, `@ts-expect-error`, and
`registerTool(`, reporting only file, line, and syntax kind. Tests for the
scanner contain one fixture per forbidden construct plus missing, stale,
duplicate, detached, clause-mismatch, and unregistered transition comments. A
regression assertion also requires the bare `typescript` API import and rejects
all `@typescript/native` and `typescript/unstable/*` imports in the checker.

The shell and SQL registries use the same four exact contract clauses plus raw
SHA-256, sorted by path. They begin with empty transition arrays and are
incrementally exhaustive for governed roots. The shell gate accepts only
registered `*.sh` under `infra/datahub` or `infra/postgres/init`, requires a
literal shebang followed immediately by the four `# LLM-CONTRACT` lines,
rejects dynamic command names, `eval`, `source`, backticks, network clients,
unchecked pipelines, and unbounded reads, then runs pinned ShellCheck. The SQL
gate accepts only registered `*.sql` under `infra/postgres`, requires four
leading `-- LLM-CONTRACT` lines, and rejects include indirection,
`COPY ... PROGRAM`, dynamic SQL, unqualified security-sensitive object names,
and transaction-control outside its declared migration class. Its sole
variable exception is the digest-bound executor-role migration's exact initial
`\getenv executor_password EXECUTOR_DB_PASSWORD` plus one matching `\unset`;
every other psql meta-command or variable is forbidden. Every later PR creating
or changing governed shell or SQL authority updates the matching registry in
the same PR.

`security/github-actions-uses.v1.json` is a closed map from exact repository
and semantic release label to one full 40-hex commit SHA. The initial allowlist
is:

```text
actions/checkout v7.0.1
  3d3c42e5aac5ba805825da76410c181273ba90b1
cachix/install-nix-action v31.11.0
  630ae543ea3a38a9a4166f03376c02c50f408342
actions/upload-artifact v7.0.1
  043fb46d1a93c77aae656e7c1c64a875d1fc6a0a
actions/download-artifact v8.0.1
  3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c
actions/attest-build-provenance v4.1.1
  0f67c3f4856b2e3261c31976d6725780e5e4c373
```

`check-policy-workflow.mjs` parses every regular, non-symlink
`.github/workflows/*.yml` and `*.yaml` without executing it, rejects every
other extension, case-colliding path, YAML alias/merge key, and local/dynamic
action, and
requires every `uses:` value to be `owner/repository@<allowlisted-full-SHA>`.
It rejects tag/branch refs, Docker actions, mutable action subpaths, workflow
`pull_request_target`, write-all permissions, and `${{ }}` interpolation in
`uses:`. Tests cover each rejection, a mutable action hidden in a `.yaml`
fixture, and an exact pinned fixture.

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
overrides:
  "@modelcontextprotocol/sdk": "1.29.0"
  "zod": "4.4.3"
```

pnpm 11 no longer reads non-auth settings from the `pnpm` field in
`package.json`; root settings belong in `pnpm-workspace.yaml`. The placement
above follows the official
[pnpm package manifest](https://pnpm.io/package_json) and
[settings](https://pnpm.io/settings#overrides) documentation. The mandatory
`pnpm pnpm-settings:check` gate rejects ignored `package.json#pnpm` settings
and their pnpm diagnostic, then requires the effective configuration and
lockfile to contain exactly the two reviewed overrides above.

```json
{
  "files": [],
  "references": []
}
```

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "lib": ["ES2024"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noPropertyAccessFromIndexSignature": true,
    "useUnknownInCatchVariables": true,
    "verbatimModuleSyntax": true,
    "allowUnreachableCode": false,
    "allowUnusedLabels": false,
    "declaration": true,
    "composite": true,
    "skipLibCheck": false
  }
}
```

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "composite": false,
    "declaration": false,
    "noEmit": true
  },
  "include": [
    "scripts/**/*.mjs",
    "infra/datahub/**/*.mjs"
  ]
}
```

Every included `.mjs` file uses closed JSDoc typedefs and `unknown` at external
boundaries. The scripts config is release-blocking; trusted bootstrap,
provenance, image-lock, secret, startup/teardown, and GO/NO-GO code may not rely
on implicit `any`. Root `pnpm test` delegates only to workspace package unit
scripts. Query package tests exclude `*.integration.test.ts`; PostgreSQL and
real-service suites remain owned exclusively by their clean lifecycle runners.

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.5/schema.json",
  "files": {
    "includes": ["**", "!!**/dist", "!!**/.venv", "!!**/node_modules"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "preset": "recommended",
      "suspicious": {
        "noExplicitAny": "error",
        "noDoubleEquals": "error"
      }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "semicolons": "always"
    }
  }
}
```

The `preset` form follows the
[Biome 2.5 release contract](https://github.com/biomejs/website/blob/main/src/content/docs/blog/biome-v2-5.mdx);
the deprecated `recommended` boolean is forbidden.

```gitignore
.cache/
.direnv/
.venv/
coverage/
dist/
node_modules/
work/
```

1A creates this minimal four-system flake. It is sufficient to generate and
consume `pnpm-lock.yaml` without relying on host Node or pnpm:

```nix
{
  description = "DataHub OKF governed query workspace";
  inputs.nixpkgs.url =
    "github:NixOS/nixpkgs/8623c4c20aa4ca2f5fb81510d2944066c3fb0d96";
  outputs = { nixpkgs, ... }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
    in {
      devShells = nixpkgs.lib.genAttrs systems (system:
        let pkgs = import nixpkgs { inherit system; };
        in {
          default = pkgs.mkShell {
            packages = [ pkgs.nodejs_24 pkgs.pnpm_11 ];
            shellHook = ''
              test "$(node --version)" = "v24.18.0"
              test "$(pnpm --version)" = "11.17.0"
            '';
          };
        });
    };
}
```

1B replaces that file with the following expanded flake while retaining the
identical input URL, so `flake.lock` must remain byte-identical:

```nix
{
  description = "DataHub OKF governed query development shell";
  inputs.nixpkgs.url =
    "github:NixOS/nixpkgs/8623c4c20aa4ca2f5fb81510d2944066c3fb0d96";
  outputs = { nixpkgs, ... }:
    let
      systems = [ "aarch64-darwin" "x86_64-darwin" "aarch64-linux" "x86_64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      perSystem = system:
        let
          pkgs = import nixpkgs { inherit system; };
          uvExact = import ./nix/uv-0.11.32.nix { inherit pkgs; };
          leanExact = import ./nix/lean4-4.32.1.nix { inherit pkgs system; };
          toolchain = [
            pkgs.nodejs_24
            pkgs.pnpm_11
            uvExact
            leanExact
            pkgs.postgresql_18
            pkgs.docker-client
            pkgs.docker-compose
            pkgs.docker-buildx
            pkgs.shellcheck
            pkgs.gh
            pkgs.jq
          ];
          toolchainCheck = pkgs.runCommand "governed-query-toolchain-check" {
            nativeBuildInputs = toolchain;
          } ''
            test "$(node --version)" = "v24.18.0"
            test "$(pnpm --version)" = "11.17.0"
            test "$(uv --version)" = "uv 0.11.32"
            lean --version | grep -F "Lean (version 4.32.1,"
            test "$(postgres --version)" = "postgres (PostgreSQL) 18.4"
            case "$(docker --version)" in
              "Docker version 29.6.2,"*) ;;
              *) exit 1 ;;
            esac
            test "$(docker compose version)" = "Docker Compose version v5.1.4"
            docker buildx version | grep -F " v0.31.1 "
            shellcheck --version | grep -F "version: 0.11.0"
            touch "$out"
          '';
        in { inherit pkgs toolchain toolchainCheck; };
    in {
      devShells = forAllSystems (system:
        let resolved = perSystem system;
        in {
          default = resolved.pkgs.mkShell {
            packages = resolved.toolchain;
          };
        });
      checks = forAllSystems (system: {
        toolchain = (perSystem system).toolchainCheck;
      });
    };
}
```

`nix/uv-0.11.32.nix` overrides only the pinned Nixpkgs uv derivation's version
and fixed sources. It uses the official uv v0.11.32 source hash
`sha256-Vkh4GWcKpaAVrok7K/620jfaFayKZRCO32icfZ6+mSU=` and cargo vendor hash
`sha256-w8O655Ad9bz79KeWF00hniNX+fssY9ZE+LUKaWBQM7c=`; no runtime fetch is
allowed.

`nix/lean4-4.32.1.nix` selects exactly one official v4.32.1 release asset by
the closed `system` key, extracts with `zstd`, applies `autoPatchelfHook` only
on Linux, and runs `$out/bin/lean --version` during installation. Its
fixed-output ledger is:

| System | Asset | SRI SHA-256 |
|---|---|---|
| `x86_64-darwin` | `lean-4.32.1-darwin.tar.zst` | `sha256-/w8WtacSgu2EFA6lcRlTK+yuJUhR6LQB5Ol+0jdBKOY=` |
| `aarch64-darwin` | `lean-4.32.1-darwin_aarch64.tar.zst` | `sha256-lZNTjosoZ8Vl53hTZ9ZMh9kIoxDXn5fbqdqNkOK8HU0=` |
| `x86_64-linux` | `lean-4.32.1-linux.tar.zst` | `sha256-V9XAYqa0uub7pRGhcEqhJN/0YcN9D8lFhWN/u32VG1A=` |
| `aarch64-linux` | `lean-4.32.1-linux_aarch64.tar.zst` | `sha256-mbUcsroq5ALAMYXyymVugrbDfSjKmfOwehwtBLWKA5o=` |

The two imported expressions are executable, not placeholders:

```nix
# nix/uv-0.11.32.nix
{ pkgs }:
let
  src = pkgs.fetchFromGitHub {
    owner = "astral-sh";
    repo = "uv";
    rev = "0.11.32";
    hash = "sha256-Vkh4GWcKpaAVrok7K/620jfaFayKZRCO32icfZ6+mSU=";
  };
in pkgs.uv.overrideAttrs (_old: {
  version = "0.11.32";
  inherit src;
  cargoDeps = pkgs.rustPlatform.fetchCargoVendor {
    inherit src;
    hash = "sha256-w8O655Ad9bz79KeWF00hniNX+fssY9ZE+LUKaWBQM7c=";
  };
})
```

```nix
# nix/lean4-4.32.1.nix
{ pkgs, system }:
let
  assets = {
    x86_64-darwin = {
      file = "lean-4.32.1-darwin.tar.zst";
      hash = "sha256-/w8WtacSgu2EFA6lcRlTK+yuJUhR6LQB5Ol+0jdBKOY=";
    };
    aarch64-darwin = {
      file = "lean-4.32.1-darwin_aarch64.tar.zst";
      hash = "sha256-lZNTjosoZ8Vl53hTZ9ZMh9kIoxDXn5fbqdqNkOK8HU0=";
    };
    x86_64-linux = {
      file = "lean-4.32.1-linux.tar.zst";
      hash = "sha256-V9XAYqa0uub7pRGhcEqhJN/0YcN9D8lFhWN/u32VG1A=";
    };
    aarch64-linux = {
      file = "lean-4.32.1-linux_aarch64.tar.zst";
      hash = "sha256-mbUcsroq5ALAMYXyymVugrbDfSjKmfOwehwtBLWKA5o=";
    };
  };
  asset = assets.${system} or (throw "unsupported Lean system");
in pkgs.stdenvNoCC.mkDerivation {
  pname = "lean4";
  version = "4.32.1";
  src = pkgs.fetchurl {
    url = "https://github.com/leanprover/lean4/releases/download/v4.32.1/${asset.file}";
    inherit (asset) hash;
  };
  nativeBuildInputs = [ pkgs.zstd ]
    ++ pkgs.lib.optionals pkgs.stdenv.isLinux [ pkgs.autoPatchelfHook ];
  buildInputs = pkgs.lib.optionals pkgs.stdenv.isLinux [
    pkgs.stdenv.cc.cc.lib pkgs.gmp pkgs.libffi
  ];
  unpackPhase = ''
    mkdir source
    tar --use-compress-program=unzstd -xf "$src" -C source --strip-components=1
  '';
  sourceRoot = "source";
  installPhase = ''
    mkdir -p "$out"
    cp -R . "$out/"
    "$out/bin/lean" --version | grep -F "Lean (version 4.32.1,"
  '';
}
```

Both expressions reject any system outside the four-key ledger. The flake
check must evaluate all four systems without building on every runner.
`.github/workflows/toolchain.yml` then uses four native jobs:
`ubuntu-24.04`/`x86_64-linux`, `ubuntu-24.04-arm`/`aarch64-linux`,
`macos-15-intel`/`x86_64-darwin`, and
`macos-15`/`aarch64-darwin`. Each job uses only the immutable checkout and Nix
installer SHAs above, runs
`nix flake check --all-systems --no-build`, then builds its exact
`checks.<system>.toolchain`. Cross-system emulation is not accepted as proof.

- [ ] **Step 4 [1A → 1B → 1C CI]: Generate immutable locks and run the gate**

1A creates both locks inside its minimal exact Node/pnpm Nix shell:

```bash
nix flake lock
nix develop -c pnpm install --lockfile-only
nix develop -c pnpm pnpm-settings:check
nix develop -c pnpm install --frozen-lockfile
nix develop -c pnpm check
```

Expected for 1A: `pnpm-lock.yaml` and `flake.lock` are newly created, the
settings gate proves the effective and locked overrides match exactly without
ignored package-manifest settings, the second install proves the lock is
complete, and the 1A-only aggregate passes from a clean checkout.

After 1A merges, 1B runs:

```bash
nix flake check --all-systems --no-build
nix build ".#checks.$(nix eval --raw --impure --expr builtins.currentSystem).toolchain"
nix develop -c pnpm install --frozen-lockfile
nix develop -c pnpm toolchain:check
git diff --exit-code -- flake.lock pnpm-lock.yaml
```

Expected for 1B: `toolchain versions verified`; neither lock changes and no
application dependency floats.
1C does not regenerate either lock. It runs the already-pinned local workflow
checker, then its four native GitHub jobs run the exact matrix above; all four
must pass before 1C merges.

- [ ] **Step 5: Run scanner, format, and static checks**

Run only the current Delivery row's commands. For 1A:

```bash
node --test scripts/test/check-tcb.test.mjs scripts/test/check-pnpm-settings.test.mjs
pnpm check
```

For 1B, after 1A is merged:

```bash
node --test scripts/test/check-security-shell.test.mjs scripts/test/check-security-sql.test.mjs
nix develop -c pnpm check
```

For 1C, after 1B is merged:

```bash
node --test scripts/test/check-policy-workflow.test.mjs
nix develop -c pnpm check
```

Expected for each row: PASS with zero Biome or TypeScript diagnostics. A row
must not name, import, or execute a checker or fixture owned by a later row.

- [ ] **Step 6: Review and commit**

Run the `code-review` skill, fix every P0/P1/P2 finding, then:

```bash
git add -- <every path in the current Delivery row Files cell, and no other path>
test "$(git diff --cached --name-only | LC_ALL=C sort)" = "<that row's sorted path ledger>"
git commit -m "<that row's exact Commit cell>"
```

The Delivery row Files cell is the literal staging ledger. Execute this step
separately for 1A, 1B, and 1C; a combined Task 1 commit is forbidden.

### Task 2: Closed public and internal contracts

**Delivery:** This section is an umbrella only.

| Task | Branch | Files (exhaustive) | Commit |
|---|---|---|---|
| 2A — public contracts | `feat/closed-public-contracts` | Create `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/src/literals.ts`, `packages/contracts/src/public.ts`, `packages/contracts/src/mcp-json-schemas.ts`, `packages/contracts/src/parse.ts`, `packages/contracts/src/index.ts`, `packages/contracts/test/public.test.ts`; modify `package.json`, `tsconfig.json`, `pnpm-lock.yaml`, `security/security-transitions.v1.json` | `feat(contracts): define closed public v1 contracts` |
| 2B — internal executor protocol | `feat/closed-executor-protocol` | Create `packages/contracts/src/datahub-evidence.ts`, `packages/contracts/src/executor-protocol.ts`, `packages/contracts/test/executor-protocol.test.ts`; modify `packages/contracts/src/index.ts`, `security/security-transitions.v1.json` | `feat(contracts): define closed executor protocol` |

2A runs only `public.test.ts` and snapshots the four public MCP schemas. The
`does not allow an internal request to carry a decision` case and every
executor-protocol import belong only to 2B, which then runs
`executor-protocol.test.ts` plus the already-merged public suite. Both rows run
the contracts type/Biome and TCB gates.

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/literals.ts`
- Create: `packages/contracts/src/public.ts`
- Create: `packages/contracts/src/mcp-json-schemas.ts`
- Create: `packages/contracts/src/datahub-evidence.ts`
- Create: `packages/contracts/src/executor-protocol.ts`
- Create: `packages/contracts/src/parse.ts`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/test/public.test.ts`
- Create: `packages/contracts/test/executor-protocol.test.ts`
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `pnpm-lock.yaml`
- Modify: `security/security-transitions.v1.json`

**Interfaces:**
- Consumes: Zod 4 `z.strictObject`, `z.discriminatedUnion`, and `safeParse`.
- Produces: `parseGetEntityContextInput(value: unknown)`, `parseGovernedQueryInput(value: unknown)`, `parseExecutorRequest(value: unknown)`, `parseExecutorResponse(value: unknown)`, and their inferred readonly types.

- [ ] **Step 1: Write contract rejection tests first**

```ts
import { describe, expect, it } from "vitest";
import {
  DATASET_URN,
  parseGovernedQueryInput,
} from "../src/index.js";

describe("closed v1 contracts", () => {
  it("rejects unknown keys without returning Zod details", () => {
    const parsed = parseGovernedQueryInput({
      apiVersion: "v1",
      datasetUrn: DATASET_URN,
      projection: ["customer_id"],
      predicates: [],
      limit: 1,
      sql: "SELECT email",
    });
    expect(parsed).toEqual({ ok: false, reasonCode: "INVALID_INPUT" });
  });

  it("accepts the value-free prohibited sentinel only for email EQ", () => {
    const parsed = parseGovernedQueryInput({
      apiVersion: "v1",
      datasetUrn: DATASET_URN,
      projection: ["customer_id"],
      predicates: [{
        fieldId: "email",
        operator: "EQ",
        value: { type: "PROHIBITED" },
      }],
      limit: 1,
    });
    expect(parsed.ok).toBe(true);
  });
});
```

2B adds the internal-only rejection to
`executor-protocol.test.ts` after the protocol exists:

```ts
it("does not allow an internal request to carry a decision", () => {
  const validRequest = validInspectExecutorRequest();
  expect(parseExecutorRequest(validRequest).ok).toBe(true);
  expect(parseExecutorRequest({ ...validRequest, decision: "ALLOW" }))
    .toEqual({ ok: false, reasonCode: "INVALID_INPUT" });
});
```

- [ ] **Step 2: Run the focused tests and verify missing exports**

For 2A run:

```bash
pnpm exec vitest run packages/contracts/test/public.test.ts
```

Expected: FAIL because `packages/contracts/src/index.ts` does not exist.

After 2A merges, for 2B run:

```bash
pnpm exec vitest run packages/contracts/test/executor-protocol.test.ts
```

Expected: FAIL because the internal protocol export does not exist. Neither row
references the other row's not-yet-created test.

- [ ] **Step 3: Implement the closed literal and value unions**

```json
{
  "name": "@okf-datahub/contracts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {".": "./dist/index.js"},
  "types": "./dist/index.d.ts",
  "dependencies": {"zod": "4.4.3"},
  "scripts": {
    "build": "tsc -b",
    "check": "tsc --noEmit",
    "test": "vitest run --maxWorkers=1"
  }
}
```

Add `{"path":"./packages/contracts"}` to the root `tsconfig.json` references.
In the same 2A change, insert `tsc -b --pretty false` between `biome check .`
and `pnpm scripts:check` in the root aggregate `check` script.

```ts
// packages/contracts/src/literals.ts
export const DATASET_URN =
  "urn:li:dataset:(urn:li:dataPlatform:postgres,demo.analytics.customer_orders,PROD)";
export const FIELD_IDS: readonly [
  "customer_id", "email", "total", "status", "placed_on",
] = Object.freeze(["customer_id", "email", "total", "status", "placed_on"]);
export const SAFE_FIELD_IDS: readonly [
  "customer_id", "total", "status", "placed_on",
] = Object.freeze(["customer_id", "total", "status", "placed_on"]);
export const REASON_CODES: readonly [
  "POLICY_ALLOWED", "INVALID_INPUT", "RESOURCE_NOT_BOUND",
  "CONTEXT_UNAVAILABLE", "CONTEXT_INVALID", "POLICY_INTEGRITY_FAILED",
  "POLICY_EXPIRED", "FIELD_UNKNOWN", "FIELD_USE_DENIED", "RESOURCE_BUSY",
  "DB_SCHEMA_MISMATCH", "EXECUTION_TIMEOUT", "OUTPUT_INVALID",
  "INTERNAL_FAILURE",
] = Object.freeze([
  "POLICY_ALLOWED", "INVALID_INPUT", "RESOURCE_NOT_BOUND",
  "CONTEXT_UNAVAILABLE", "CONTEXT_INVALID", "POLICY_INTEGRITY_FAILED",
  "POLICY_EXPIRED", "FIELD_UNKNOWN", "FIELD_USE_DENIED", "RESOURCE_BUSY",
  "DB_SCHEMA_MISMATCH", "EXECUTION_TIMEOUT", "OUTPUT_INVALID",
  "INTERNAL_FAILURE",
]);
export const OPERATION_ID = /^[0-9a-f]{32}$/;
export const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;

export const operationIdSchema =
  z.string().regex(OPERATION_ID).brand<"OperationId">();
export type OperationId = z.infer<typeof operationIdSchema>;
export function parseTrustedOperationId(value: unknown): OperationId {
  return operationIdSchema.parse(value);
}
```

`parseTrustedOperationId` is the sole throwing constructor and is private to
trusted randomness/transport code; untrusted public input continues to use
`safeParse` and fixed failure envelopes.

```ts
// packages/contracts/src/public.ts
import { z } from "zod";
import { DATASET_URN, FIELD_IDS } from "./literals.js";

const fieldId = z.enum(FIELD_IDS);
const opaque = z.strictObject({
  type: z.literal("OPAQUE_ID"),
  value: z.string().regex(/^cust_[0-9]{3,12}$/).max(64),
});
const decimal = z.strictObject({
  type: z.literal("DECIMAL"),
  value: z.string().regex(/^(?:0|[1-9][0-9]{0,9})(?:\.[0-9]{1,2})?$/),
});
const status = z.strictObject({
  type: z.literal("ENUM"),
  value: z.enum(["PENDING", "PAID", "CANCELLED"]),
});
const date = z.strictObject({
  type: z.literal("DATE"),
  value: z.string().regex(/^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$/),
});
const prohibited = z.strictObject({ type: z.literal("PROHIBITED") });

export const governedQueryInputSchema = z.strictObject({
  apiVersion: z.literal("v1"),
  datasetUrn: z.literal(DATASET_URN),
  projection: z.array(fieldId).min(1).max(5),
  predicates: z.array(z.strictObject({
    fieldId,
    operator: z.enum(["EQ", "LT", "LTE", "GT", "GTE"]),
    value: z.discriminatedUnion("type", [opaque, decimal, status, date, prohibited]),
  })).max(5),
  limit: z.number().int().min(1).max(100),
}).superRefine(validateUniqueProjectionAndTypedPredicates);

export type DeepReadonly<T> =
  T extends readonly unknown[]
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;
export type GovernedQueryInputV1 =
  DeepReadonly<z.infer<typeof governedQueryInputSchema>>;
```

`validateUniqueProjectionAndTypedPredicates` must check valid calendar dates, decimal numeric range, unique projection IDs, and the exact field/operator/value matrix. It must add issues only inside Zod; callers map all failures to one fixed code.

```ts
// packages/contracts/src/parse.ts
export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reasonCode: "INVALID_INPUT" };

export function parseUnknown<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  value: unknown,
): ParseResult<DeepReadonly<T>> {
  const parsed = schema.safeParse(value);
  return parsed.success
    ? { ok: true, value: deepFreezeValidatedCopy(parsed.data) }
    : { ok: false, reasonCode: "INVALID_INPUT" };
}
```

`deepFreezeValidatedCopy` supports only the already-validated JSON value tree,
creates fresh null-prototype records/arrays, recursively freezes every node, and
returns `DeepReadonly<T>` without exposing mutable aliases. Mutation tests cover
top-level properties, projection/predicate arrays, each predicate/value,
DataHub field/tag arrays, artifact field rules, and result rows; attempted
mutation must throw or leave the validated value byte-identical.

- [ ] **Step 4: Define all four internal variants and sanitized evidence**

`DataHubEvidenceV1` must contain only `deploymentId`, exact URNs/platform, five
ordered fields with native types, normalized `PII`, and the five fixed
pagination counters (`totalFields`, `returned`, `remainingCount`,
`matchingCount`, `offset`). Define `InspectContextRequestV1`,
`ExecuteQueryRequestV1`, `ContextSuccessV1 | ContextRejectedV1`, and
`QuerySuccessV1 | QueryRejectedV1` as strict discriminated unions; no request
schema has SQL, policy, database identifiers, endpoint, credential, prose, or
decision properties.

```ts
export const executorRequestSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    apiVersion: z.literal("executor-request/v1"),
    operation: z.literal("INSPECT_CONTEXT"),
    operationId: operationIdSchema,
    request: getEntityContextInputSchema,
    datahubContext: dataHubEvidenceSchema,
    datahubContextDigest: digestSchema,
  }),
  z.strictObject({
    apiVersion: z.literal("executor-request/v1"),
    operation: z.literal("EXECUTE_QUERY"),
    operationId: operationIdSchema,
    request: governedQueryInputSchema,
    datahubContext: dataHubEvidenceSchema,
    datahubContextDigest: digestSchema,
  }),
]);
```

- [ ] **Step 5: Export exact MCP JSON Schema projections**

```ts
// packages/contracts/src/mcp-json-schemas.ts
import { z } from "zod";
import {
  contextResultSchema,
  getEntityContextInputSchema,
  governedQueryInputSchema,
  queryResultSchema,
} from "./public.js";

export const GET_ENTITY_CONTEXT_INPUT_JSON_SCHEMA =
  z.toJSONSchema(getEntityContextInputSchema, {
    target: "draft-7",
    unrepresentable: "throw",
  });
export const GET_ENTITY_CONTEXT_OUTPUT_JSON_SCHEMA =
  z.toJSONSchema(contextResultSchema, {
    target: "draft-7",
    unrepresentable: "throw",
  });
export const GOVERNED_QUERY_INPUT_JSON_SCHEMA =
  z.toJSONSchema(governedQueryInputSchema, {
    target: "draft-7",
    unrepresentable: "throw",
  });
export const GOVERNED_QUERY_OUTPUT_JSON_SCHEMA =
  z.toJSONSchema(queryResultSchema, {
    target: "draft-7",
    unrepresentable: "throw",
  });
```

Snapshot all four schemas and assert every object node has
`"additionalProperties": false`, all versions are literals, and all numeric,
array, regex, and enum bounds are present.

- [ ] **Step 6: Run contract and property tests**

For 2A run:

```bash
pnpm exec vitest run packages/contracts/test/public.test.ts --maxWorkers=1
pnpm tcb:check
pnpm exec tsc -p packages/contracts/tsconfig.json --noEmit
pnpm exec biome check packages/contracts
pnpm check
```

The focused test, TCB check, package type check, and package Biome check all
remain mandatory. The final `pnpm check` runs the root aggregate after Step 3
restores `tsc -b --pretty false`, so it additionally verifies the solution
project-reference graph and declaration build; it does not replace any
preceding command.

For 2B run:

```bash
pnpm exec vitest run packages/contracts/test/public.test.ts packages/contracts/test/executor-protocol.test.ts --maxWorkers=1
pnpm tcb:check
pnpm exec tsc -p packages/contracts/tsconfig.json --noEmit
pnpm exec biome check packages/contracts
```

Expected: PASS; each row's fast-check property over arbitrary extra keys always
returns `{ok:false, reasonCode:"INVALID_INPUT"}`.

- [ ] **Step 7: Review and commit**

Run the `code-review` skill, then:

```bash
git add -- <every path in the current Delivery row Files cell, and no other path>
test "$(git diff --cached --name-only | LC_ALL=C sort)" = "<that row's sorted path ledger>"
git commit -m "<that row's exact Commit cell>"
```

Execute separately for 2A and 2B; the row Files cell is the staging ledger.

### Task 3: Canonical JSON, artifact schemas, and domain-separated digests

**Delivery:** This section is an umbrella only.

| Task | Branch | Files (exhaustive) | Commit |
|---|---|---|---|
| 3A — canonical bytes and digests | `feat/canonical-domain-digests` | Create `packages/contracts/src/canonical-json.ts`, `packages/contracts/src/digest.ts`, `packages/contracts/test/canonical-json.test.ts`; modify `packages/contracts/src/index.ts`, `security/security-transitions.v1.json` | `feat(contracts): add canonical domain hashing` |
| 3B — artifact and runtime-schema contracts | `feat/closed-policy-artifacts` | Create `packages/contracts/src/artifacts.ts`, `packages/contracts/src/runtime-schema.ts`, `packages/contracts/test/artifacts.test.ts`, `packages/contracts/test/runtime-schema.test.ts`; modify `packages/contracts/src/index.ts`, `security/security-transitions.v1.json` | `feat(contracts): define closed policy artifacts` |

3A runs only `canonical-json.test.ts` plus contracts type/Biome/TCB gates. 3B
runs `artifacts.test.ts` and `runtime-schema.test.ts`, then the full contracts
suite. No 3A test imports an artifact schema owned by 3B.

**Files:**
- Create: `packages/contracts/src/canonical-json.ts`
- Create: `packages/contracts/src/digest.ts`
- Create: `packages/contracts/src/artifacts.ts`
- Create: `packages/contracts/src/runtime-schema.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/contracts/test/canonical-json.test.ts`
- Create: `packages/contracts/test/artifacts.test.ts`
- Create: `packages/contracts/test/runtime-schema.test.ts`
- Modify: `security/security-transitions.v1.json`

**Interfaces:**
- Consumes: already-validated closed `CanonicalJsonValue` or exact reviewed
  source bytes.
- Produces: `canonicalize(value)`, `canonicalSha256(domain, value)`,
  `rawSha256(bytes)`, and parsers for `PolicyIrV1`, `ResourceBindingV1`,
  `ReviewAttestationV1`, `PolicyManifestV1`, and
  `RuntimeSchemaProjectionV1`.

- [ ] **Step 1: Write canonical byte and domain separation tests**

```ts
it("sorts object keys and emits exact UTF-8 bytes", () => {
  expect(canonicalize({ z: "é", a: 1 })).toEqual(
    Buffer.from('{"a":1,"z":"é"}', "utf8"),
  );
});

it("separates identical JSON across domains", () => {
  const value = { apiVersion: 1 };
  expect(canonicalSha256("policy-ir/v1", value)).not.toBe(
    canonicalSha256("resource-binding/v1", value),
  );
});

it("hashes raw source bytes without canonicalization", () => {
  expect(rawSha256(Buffer.from("abc", "utf8"))).toBe(
    "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

it.each([
  Number.NaN, Number.POSITIVE_INFINITY, -0, 9_007_199_254_740_992,
  "\ud800",
])(
  "rejects unsafe canonical scalar %s",
  (value) => expect(() => canonicalize(value)).toThrow(),
);
```

- [ ] **Step 2: Run tests and verify missing implementations**

For 3A run:

```bash
pnpm exec vitest run packages/contracts/test/canonical-json.test.ts
pnpm tcb:check
pnpm exec tsc -p packages/contracts/tsconfig.json --noEmit
pnpm exec biome check packages/contracts
```

Expected: FAIL with the canonical/digest module exports missing.

After 3A merges, for 3B run:

```bash
pnpm exec vitest run packages/contracts/test/artifacts.test.ts packages/contracts/test/runtime-schema.test.ts
```

Expected: FAIL with artifact/runtime-schema exports missing. No 3A command
refers to a 3B-owned path.

- [ ] **Step 3: Implement the constrained RFC 8785 serializer**

```ts
export type CanonicalJsonValue =
  | null
  | boolean
  | string
  | number
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

function isCanonicalArray(
  value: CanonicalJsonValue,
): value is readonly CanonicalJsonValue[] {
  return Array.isArray(value);
}

function isCanonicalObject(
  value: CanonicalJsonValue,
): value is Readonly<Record<string, CanonicalJsonValue>> {
  return typeof value === "object" && value !== null && !isCanonicalArray(value);
}

function hasLoneSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function encodeJsonString(value: string): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError("string encoding failed");
  return encoded;
}

function encode(value: CanonicalJsonValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    if (hasLoneSurrogate(value)) throw new TypeError("invalid Unicode scalar string");
    return encodeJsonString(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
      throw new TypeError("canonical JSON accepts safe non-negative schema integers only");
    }
    return String(value);
  }
  if (isCanonicalArray(value)) return `[${value.map(encode).join(",")}]`;
  if (!isCanonicalObject(value)) throw new TypeError("unsupported canonical JSON value");
  return `{${Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  ).map(([key, item]) => {
    if (hasLoneSurrogate(key)) throw new TypeError("invalid Unicode key");
    return `${encodeJsonString(key)}:${encode(item)}`;
  }
  ).join(",")}}`;
}

export function canonicalize(value: CanonicalJsonValue): Uint8Array {
  return new TextEncoder().encode(encode(value));
}
```

The implementation may not accept floating JSON numbers. Decimals, dates,
timestamps, URNs, and digests remain strings; only explicitly declared,
bounded, non-negative safe-integer fields such as versions, ordinals, review
numbers, and compiler-manifest byte lengths may be numeric.

```ts
import { createHash } from "node:crypto";

export type DigestDomain =
  | "policy-ir/v1"
  | "resource-binding/v1"
  | "review-attestation/v1"
  | "policy-manifest/v1"
  | "compiler-artifact/v1"
  | "datahub-evidence/v1"
  | "postgres-schema/v1"
  | "postgres-runtime-schema/v1";

export function rawSha256(bytes: Uint8Array): `sha256:${string}` {
  const hash = createHash("sha256");
  hash.update(bytes);
  return `sha256:${hash.digest("hex")}`;
}

export function canonicalSha256(
  domain: DigestDomain,
  value: CanonicalJsonValue,
): `sha256:${string}` {
  const hash = createHash("sha256");
  hash.update(domain, "ascii");
  hash.update(Uint8Array.of(0));
  hash.update(canonicalize(value));
  return `sha256:${hash.digest("hex")}`;
}
```

- [ ] **Step 4: Add exact closed artifact schemas**

Every object at every depth uses `z.strictObject`; there are no optional,
defaulted, transformed, or coerced fields. The exact shapes are:

```ts
type PolicyIrV1 = Readonly<{
  apiVersion: "policy-ir/v1";
  policyId: "customer-orders-v1";
  resourceUrn: typeof DATASET_URN;
  status: "stable";
  defaultDecision: "DENY";
  effectiveExpiresAt: "2026-12-31T23:59:59Z";
  fields: Readonly<{
    customer_id: Readonly<{ project: "ALLOW"; filter: readonly ["EQ"] }>;
    email: Readonly<{ project: "DENY"; filter: "DENY" }>;
    total: Readonly<{
      project: "ALLOW";
      filter: readonly ["EQ", "LT", "LTE", "GT", "GTE"];
    }>;
    status: Readonly<{ project: "ALLOW"; filter: readonly ["EQ"] }>;
    placed_on: Readonly<{
      project: "ALLOW";
      filter: readonly ["EQ", "LT", "LTE", "GT", "GTE"];
    }>;
  }>;
}>;

type SourceIdentity = Readonly<{
  repository: string;
  repositoryId: string;
  path: string;
  commit: string;
  digest: `sha256:${string}`;
}>;
type OkfSpecIdentity = Readonly<{
  repository: "GoogleCloudPlatform/knowledge-catalog";
  path: "okf/SPEC.md";
  commit: "3fcbb9f828c2f23d109c855ee403c3a4c81f3a96";
  digest: "sha256:5a3311d270bebb16d558010e75064f5b75323f284992641732b1c8097511f948";
}>;
type CompilerIdentity = Readonly<{
  name: "@okf-datahub/policy-compiler";
  version: "0.1.0";
}>;

type ReviewAttestationV1 = Readonly<{
  apiVersion: "review-attestation/v1";
  approvalId: `github-review:${string}`;
  policySource: SourceIdentity;
  okfSpec: OkfSpecIdentity;
  compiler: CompilerIdentity & Readonly<{ digest: `sha256:${string}` }>;
  policyDigest: `sha256:${string}`;
  bindingDigest: `sha256:${string}`;
  review: Readonly<{
    repositoryId: string;
    pullRequestNumber: number;
    reviewDatabaseId: string;
    reviewerLogin: string;
    submittedAt: string;
    commit: string;
  }>;
}>;

`review.reviewDatabaseId` must match `^[1-9][0-9]{0,15}$`.
`approvalId` must byte-equal
`"github-review:" + review.reviewDatabaseId`; it is neither caller-supplied nor
read from OKF. The attestation parser, manifest cross-link verifier, runtime
policy store, and public context-result parser all enforce the same equality.

type PolicyManifestV1 = Readonly<{
  apiVersion: "policy-manifest/v1";
  policySource: SourceIdentity;
  okfSpec: OkfSpecIdentity;
  compiler: CompilerIdentity & Readonly<{ digest: `sha256:${string}` }>;
  policyDigest: `sha256:${string}`;
  bindingDigest: `sha256:${string}`;
  attestationDigest: `sha256:${string}`;
}>;
```

The compiler-side source, verification, and result types are also exact:

```ts
type Sha256Digest = `sha256:${string}`;

type RestrictedOkfSource = DeepReadonly<{
  type: "Data Usage Policy";
  resource: typeof DATASET_URN;
  status: "stable";
  stale_after: "2027-01-01";
  sources: readonly [
    Readonly<{ resource: "repo://governance/privacy/customer-orders" }>,
  ];
  verified: readonly [
    Readonly<{
      by: "human:data-governance";
      at: "2026-07-20T09:00:00Z";
    }>,
  ];
  "x-okf-datahub-policy": Readonly<{
    version: 1;
    policy_id: "customer-orders-v1";
    expires_at: "2026-12-31T23:59:59Z";
    default: "DENY";
    fields: PolicyIrV1["fields"];
  }>;
  body: string;
}>;

type RestrictedOkfResult =
  | Readonly<{ ok: true; value: RestrictedOkfSource }>
  | Readonly<{ ok: false; code: "POLICY_SOURCE_INVALID" }>;

type RestrictedJsonResult =
  | Readonly<{ ok: true; value: CanonicalJsonValue }>
  | Readonly<{ ok: false; code: "REVIEWED_JSON_INVALID" }>;

type ResourceBindingSourceV1 = DeepReadonly<{
  apiVersion: "resource-binding-source/v1";
  bindingId: "customer-orders-demo-v1";
  datahub: Readonly<{
    deploymentId: "demo-datahub";
    datasetUrn: typeof DATASET_URN;
    platform: "postgres";
    environment: "PROD";
  }>;
  postgres: Readonly<{
    database: "demo";
    schema: "analytics";
    relation: "customer_orders";
    relationKind: "TABLE";
    accessMethod: "heap";
  }>;
  fields: Readonly<{
    customer_id: Readonly<{ column: "customer_id"; type: "text" }>;
    email: Readonly<{ column: "email"; type: "text" }>;
    total: Readonly<{ column: "total"; type: "numeric(12,2)" }>;
    status: Readonly<{ column: "status"; type: "text" }>;
    placed_on: Readonly<{ column: "placed_on"; type: "date" }>;
  }>;
}>;

type SchemaConstraintByName = Readonly<{
  customer_orders_customer_id_octets_ck: Readonly<{
    name: "customer_orders_customer_id_octets_ck";
    kind: "CHECK";
    definition: "CHECK ((octet_length(customer_id) <= 64))";
  }>;
  customer_orders_customer_id_format_ck: Readonly<{
    name: "customer_orders_customer_id_format_ck";
    kind: "CHECK";
    definition: "CHECK ((customer_id ~ '^cust_[0-9]{3,12}$'::text))";
  }>;
  customer_orders_customer_id_unique: Readonly<{
    name: "customer_orders_customer_id_unique";
    kind: "UNIQUE";
    definition: "UNIQUE (customer_id)";
  }>;
  customer_orders_status_ck: Readonly<{
    name: "customer_orders_status_ck";
    kind: "CHECK";
    definition:
      "CHECK ((status = ANY (ARRAY['PENDING'::text, 'PAID'::text, 'CANCELLED'::text])))";
  }>;
  customer_orders_total_nonnegative_ck: Readonly<{
    name: "customer_orders_total_nonnegative_ck";
    kind: "CHECK";
    definition: "CHECK ((total >= (0)::numeric))";
  }>;
}>;

type SchemaConstraint<Name extends keyof SchemaConstraintByName> =
  SchemaConstraintByName[Name];

type SchemaColumn<
  Ordinal extends 1 | 2 | 3 | 4 | 5,
  Name extends "customer_id" | "email" | "total" | "status" | "placed_on",
  DataType extends "text" | "numeric(12,2)" | "date",
  Collation extends "C" | null,
> = Readonly<{
  ordinal: Ordinal;
  name: Name;
  type: DataType;
  notNull: true;
  collation: Collation;
  defaultExpression: null;
  generated: false;
  identity: "NONE";
}>;

type SchemaContractV1 = DeepReadonly<{
  apiVersion: "postgres-schema/v1";
  database: "demo";
  databaseProperties: Readonly<{
    encoding: "UTF8";
    collation: "C";
    ctype: "C";
  }>;
  schema: "analytics";
  relation: "customer_orders";
  owner: "demo_owner";
  relationKind: "TABLE";
  accessMethod: "heap";
  persistence: "PERMANENT";
  rowSecurity: false;
  forceRowSecurity: false;
  hasRules: false;
  hasUserTriggers: false;
  hasChildren: false;
  isPartition: false;
  inheritParents: readonly [];
  columns: readonly [
    SchemaColumn<1, "customer_id", "text", "C">,
    SchemaColumn<2, "email", "text", "C">,
    SchemaColumn<3, "total", "numeric(12,2)", null>,
    SchemaColumn<4, "status", "text", "C">,
    SchemaColumn<5, "placed_on", "date", null>,
  ];
  constraints: readonly [
    SchemaConstraint<"customer_orders_customer_id_octets_ck">,
    SchemaConstraint<"customer_orders_customer_id_format_ck">,
    SchemaConstraint<"customer_orders_customer_id_unique">,
    SchemaConstraint<"customer_orders_status_ck">,
    SchemaConstraint<"customer_orders_total_nonnegative_ck">,
  ];
  indexes: readonly [
    Readonly<{
      name: "customer_orders_customer_id_unique";
      method: "btree";
      unique: true;
      valid: true;
      ready: true;
      columns: readonly ["customer_id"];
      predicate: null;
      expression: null;
    }>,
  ];
  executorRole: Readonly<{
    name: "okf_query_executor";
    login: true;
    superuser: false;
    createdb: false;
    createrole: false;
    inherit: false;
    replication: false;
    bypassRls: false;
    connectionLimit: 1;
    memberships: readonly [];
    settings: Readonly<{
      default_transaction_read_only: "on";
      statement_timeout: "3000ms";
      lock_timeout: "250ms";
      transaction_timeout: "5000ms";
      idle_in_transaction_session_timeout: "2000ms";
      search_path: "pg_catalog";
      row_security: "on";
    }>;
  }>;
  acl: Readonly<{
    database: Readonly<{
      executor: Readonly<{ connect: true; create: false; temporary: false }>;
      public: Readonly<{ connect: false; create: false; temporary: false }>;
    }>;
    schemas: Readonly<{
      analytics: Readonly<{
        executor: Readonly<{ usage: true; create: false }>;
        public: Readonly<{ usage: false; create: false }>;
      }>;
      public: Readonly<{
        executor: Readonly<{ usage: false; create: false }>;
        public: Readonly<{ usage: false; create: false }>;
      }>;
    }>;
    relation: Readonly<{
      tablePrivileges: readonly [];
      columnSelect: readonly [
        "customer_id", "total", "status", "placed_on",
      ];
      publicPrivileges: readonly [];
    }>;
    analyticsRoutines: Readonly<{
      executorExecute: false;
      publicExecute: false;
    }>;
    monitoring: Readonly<{
      executor: Readonly<{
        schemaUsage: false;
        tableSelect: false;
        functionExecute: false;
      }>;
      public: Readonly<{
        schemaUsage: false;
        tableSelect: false;
        functionExecute: false;
      }>;
    }>;
  }>;
  extensions: readonly [
    Readonly<{
      name: "pg_stat_statements";
      version: "1.12";
      schema: "okf_monitor";
      executorAccessible: false;
    }>,
    Readonly<{
      name: "plpgsql";
      version: "1.0";
      schema: "pg_catalog";
      executorAccessible: false;
    }>,
  ];
}>;

type RuntimeSchemaProjectionV1 = DeepReadonly<{
  apiVersion: "postgres-runtime-schema/v1";
  staticContractDigest: Sha256Digest;
  portable: SchemaContractV1;
  resolved: Readonly<{
    databaseOid: number;
    analyticsNamespaceOid: number;
    publicNamespaceOid: number;
    relationOid: number;
    ownerOid: number;
    accessMethodOid: number;
    columnTypeOids: readonly [number, number, number, number, number];
    columnCollationOids: readonly [number, number, number, number, number];
    constraintOids: readonly [number, number, number, number, number];
    indexOids: readonly [number];
    allowedOperatorOids: readonly number[];
    allowedCastFunctionOids: readonly number[];
  }>;
}>;

`RuntimeSchemaProjectionV1` is validated as a strict closed object. Every OID is
a positive safe integer, every variable-length OID list is sorted ascending,
duplicate-free, and bounded by the exact reviewed operator/cast cardinality.
The portable member must canonical-byte-equal the static contract embedded by
the verified ResourceBinding. The runtime digest is only
`canonicalSha256("postgres-runtime-schema/v1", projection)`; the static
`postgres-schema/v1` digest is never reused as runtime evidence. Golden tests
use a fixed synthetic OID fixture, prove domain separation from the static
contract, and reject reordered, duplicate, missing, or additional OIDs.

declare const compilerArtifactBrand: unique symbol;
type VerifiedCompilerArtifact = Readonly<{
  digest: Sha256Digest;
  manifestRawDigest: Sha256Digest;
  fileCount: number;
  toolchain: Readonly<{
    node: "24.18.0";
    pnpm: "11.17.0";
    typescript: "7.0.2";
    nixpkgsRevision: string;
    flakeLockDigest: Sha256Digest;
    pnpmLockDigest: Sha256Digest;
  }>;
  readonly [compilerArtifactBrand]: true;
}>;

type VerifyCompilerArtifactResult =
  | Readonly<{ ok: true; value: VerifiedCompilerArtifact }>
  | Readonly<{ ok: false; code: "COMPILER_ARTIFACT_INVALID" }>;

declare const reviewApprovalBrand: unique symbol;
type VerifiedReviewApproval = Readonly<{
  repositoryId: string;
  pullRequestNumber: number;
  reviewDatabaseId: string;
  reviewerLogin: string;
  submittedAt: string;
  commit: string;
  trustedBaseCommit: string;
  readonly [reviewApprovalBrand]: true;
}>;

type VerifiedCompileProvenance = DeepReadonly<{
  policySource: SourceIdentity;
  okfSpec: OkfSpecIdentity;
  compiler: CompilerIdentity & Readonly<{ digest: Sha256Digest }>;
}>;

declare const artifactTupleBrand: unique symbol;
type VerifiedArtifactTuple = DeepReadonly<{
  provenance: VerifiedCompileProvenance;
  approval: VerifiedReviewApproval;
  policyDigest: Sha256Digest;
  bindingDigest: Sha256Digest;
  readonly [artifactTupleBrand]: true;
}>;

declare const manifestTupleBrand: unique symbol;
type VerifiedManifestTuple = DeepReadonly<{
  provenance: VerifiedCompileProvenance;
  policyDigest: Sha256Digest;
  bindingDigest: Sha256Digest;
  attestationDigest: Sha256Digest;
  readonly [manifestTupleBrand]: true;
}>;

type CompiledArtifact<Name extends string> = Readonly<{
  name: Name;
  canonicalText: string;
  byteLength: number;
  digest: Sha256Digest;
}>;

type CompilePolicyResult =
  | DeepReadonly<{
      ok: true;
      files: readonly [
        CompiledArtifact<"policy-ir.v1.json">,
        CompiledArtifact<"resource-bindings.v1.json">,
        CompiledArtifact<"review-attestation.v1.json">,
        CompiledArtifact<"policy-manifest.v1.json">,
      ];
    }>
  | Readonly<{
      ok: false;
      code:
        | "POLICY_SOURCE_INVALID"
        | "REVIEWED_JSON_INVALID"
        | "RESOURCE_BINDING_SOURCE_INVALID"
        | "SCHEMA_CONTRACT_INVALID"
        | "COMPILER_ARTIFACT_INVALID"
        | "POLICY_PROVENANCE_INVALID"
        | "POLICY_REVIEW_INVALID"
        | "POLICY_ARTIFACT_INVALID";
    }>;
```

All corresponding Zod schemas are authoritative, strict at every depth, and
their inferred types must pass compile-time exact-equality tests against the
expanded types above. There are no generic exported constructors for the
verified class/tuples; only the live-review verifier and equality-checking
binders can construct them. `SchemaConstraint<Name>` is not
`{name: string; definition: string}`. Successful values are deep-copied and
recursively frozen before being returned; raw-byte helpers return fresh copies,
while compiled artifacts expose only immutable canonical text.

The two `unique symbol` values and their module-local implementation classes
are not exported. Class-owned static factories perform the complete live
verification and call their own private constructors; public verifier
functions can return the opaque branded interfaces but cannot accept a proof
or generic object constructor. `verifyCompilerArtifact` performs canonical
manifest validation, full closure traversal, toolchain/lock equality, and
recomputation of both digests. The live-review factory performs paginated
GitHub verification itself. Tests prove plain objects, parsed JSON, fake
responses, and generic schema parsing cannot construct either authority.

`ResourceBindingV1` is exactly the JSON object in design section 10.4,
including one fixed `datahub` identity, one fixed `postgres` relation plus
`schemaContractDigest`, and exactly the five named field-to-column/type
mappings. Its schema replaces the illustrative digest with
`SHA256_DIGEST`; no other field, database, relation, kind, access method, or
mapping is accepted. Review numbers are positive safe integers; timestamps,
repository/path/login/commit/review IDs and all digests use closed
ASCII/length/format schemas.

```ts
export const artifactEnvelopeSchema = z.discriminatedUnion("apiVersion", [
  policyIrSchema,
  resourceBindingSchema,
  reviewAttestationSchema,
  policyManifestSchema,
]);

export function parsePolicyManifest(value: unknown): ParseResult<PolicyManifestV1> {
  return parseUnknown(policyManifestSchema, value);
}
```

Task 3 exports only artifact schemas/types and never imports
`policy-compiler`. The following declarations are the Task 5 implementation
contract for compiler-owned pure builders:

```ts
declare function buildPolicyIr(source: RestrictedOkfSource): PolicyIrV1;
declare function buildResourceBinding(
  source: ResourceBindingSourceV1,
  schemaContractDigest: `sha256:${string}`,
): ResourceBindingV1;
declare function buildReviewAttestation(
  tuple: VerifiedArtifactTuple,
): ReviewAttestationV1;
declare function buildManifest(tuple: VerifiedManifestTuple): PolicyManifestV1;
declare function canonicalArtifactSet(
  policy: PolicyIrV1,
  binding: ResourceBindingV1,
  attestation: ReviewAttestationV1,
  manifest: PolicyManifestV1,
): CompilePolicyResult;
```

Builders cannot read globals, environment, Git, clock, or network. Each
revalidates its output through its exact schema. `canonicalArtifactSet` returns
only the four fixed filenames, immutable canonical JSON strings, exact UTF-8
byte lengths, and domain-separated digests, and revalidates every
manifest/attestation cross-link before success. Non-empty typed arrays are
never presented as immutable artifacts.

- [ ] **Step 5: Run golden, mutation, and schema tests**

For 3A run:

```bash
pnpm exec vitest run packages/contracts/test/canonical-json.test.ts
pnpm tcb:check
pnpm exec tsc -p packages/contracts/tsconfig.json --noEmit
pnpm exec biome check packages/contracts
```

For 3B run:

```bash
pnpm exec vitest run packages/contracts/test/canonical-json.test.ts packages/contracts/test/artifacts.test.ts packages/contracts/test/runtime-schema.test.ts
pnpm tcb:check
pnpm exec tsc -p packages/contracts/tsconfig.json --noEmit
pnpm exec biome check packages/contracts
```

Expected: PASS; one-byte changes alter the digest, unknown keys/versions reject, and canonical golden bytes are exact.

- [ ] **Step 6: Review and commit**

Run the `code-review` skill, then:

```bash
git add -- <every path in the current Delivery row Files cell, and no other path>
test "$(git diff --cached --name-only | LC_ALL=C sort)" = "<that row's sorted path ledger>"
git commit -m "<that row's exact Commit cell>"
```

Execute separately for 3A and 3B; the row Files cell is the staging ledger.

### Task 4: Restricted OKF v0.2 concept parser

**Delivery:** This section is an umbrella only.

| Task | Branch | Files (exhaustive) | Commit |
|---|---|---|---|
| 4A — restricted OKF parser | `feat/restricted-okf-parser` | Create `packages/policy-compiler/package.json`, `packages/policy-compiler/tsconfig.json`, `packages/policy-compiler/src/restricted-okf.ts`, `packages/policy-compiler/test/restricted-okf.test.ts`, the named `packages/policy-compiler/test/fixtures/rejected/*.md` files; modify `tsconfig.json`, `pnpm-lock.yaml`, `security/security-transitions.v1.json` | `feat(policy-compiler): reject unsafe OKF frontmatter` |
| 4B — restricted reviewed JSON | `feat/restricted-reviewed-json` | Create `packages/policy-compiler/src/restricted-json.ts`, `packages/policy-compiler/src/source-schema.ts`, `packages/policy-compiler/test/restricted-json.test.ts`; modify `security/security-transitions.v1.json` | `feat(policy-compiler): reject unsafe reviewed JSON` |

4A runs only `restricted-okf.test.ts` plus compiler type/Biome/TCB gates. 4B
runs `restricted-json.test.ts` and then both parser suites. The 4A OKF parser
does not import the later reviewed-JSON module.

**Files:**
- Create: `packages/policy-compiler/package.json`
- Create: `packages/policy-compiler/tsconfig.json`
- Create: `packages/policy-compiler/src/restricted-okf.ts`
- Create: `packages/policy-compiler/src/restricted-json.ts`
- Create: `packages/policy-compiler/src/source-schema.ts`
- Create: `packages/policy-compiler/test/restricted-okf.test.ts`
- Create: `packages/policy-compiler/test/restricted-json.test.ts`
- Create: `packages/policy-compiler/test/fixtures/rejected/*.md`
- Modify: `tsconfig.json`
- Modify: `pnpm-lock.yaml`
- Modify: `security/security-transitions.v1.json`

**Interfaces:**
- Consumes: UTF-8 bytes, maximum 65,536 bytes.
- Produces: `parseRestrictedOkf(bytes: Uint8Array): RestrictedOkfResult`; it returns normalized data or the fixed build error `POLICY_SOURCE_INVALID`.

- [ ] **Step 1: Write the rejection matrix**

```ts
const rejected = [
  "missing-opening-delimiter.md", "missing-closing-delimiter.md",
  "crlf.md", "alias.md", "anchor.md", "merge.md", "custom-tag.md",
  "duplicate-key.md", "nul.md", "too-deep.md", "too-many-nodes.md",
  "unknown-policy-key.md",
];

for (const fixture of rejected) {
  it(`rejects ${fixture}`, async () => {
    const bytes = await readFile(new URL(`fixtures/rejected/${fixture}`, import.meta.url));
    expect(parseRestrictedOkf(bytes)).toEqual({
      ok: false,
      code: "POLICY_SOURCE_INVALID",
    });
  });
}
```

- [ ] **Step 2: Run and verify all fixtures fail because the parser is absent**

Run: `pnpm exec vitest run packages/policy-compiler/test/restricted-okf.test.ts`

Expected: FAIL with missing `restricted-okf.js`.

- [ ] **Step 3: Implement byte, document, graph, and tag checks before conversion**

```json
{
  "name": "@okf-datahub/policy-compiler",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {"okf-policy-compile": "./dist/cli.js"},
  "dependencies": {
    "@okf-datahub/contracts": "workspace:*",
    "jsonc-parser": "3.3.1",
    "yaml": "2.9.0",
    "zod": "4.4.3"
  },
  "scripts": {
    "build": "tsc -b",
    "check": "tsc --noEmit",
    "test": "vitest run --maxWorkers=1"
  }
}
```

Add `{"path":"./packages/policy-compiler"}` to the root `tsconfig.json`
references and `{"path":"../contracts"}` to the compiler `tsconfig.json`.

```ts
import {
  isAlias, isMap, isPair, isScalar, isSeq, parseDocument, visit,
} from "yaml";

const MAX_BYTES = 65_536;
const MAX_DEPTH = 12;
const MAX_NODES = 512;
const MAX_COLLECTION_ITEMS = 64;
const MAX_SCALAR_BYTES = 4_096;

function isAcceptedCoreTag(tag: string): boolean {
  switch (tag) {
    case "tag:yaml.org,2002:map":
    case "tag:yaml.org,2002:seq":
    case "tag:yaml.org,2002:str":
    case "tag:yaml.org,2002:null":
    case "tag:yaml.org,2002:bool":
    case "tag:yaml.org,2002:int":
      return true;
    default:
      return false;
  }
}

export function parseRestrictedOkf(bytes: Uint8Array): RestrictedOkfResult {
  if (bytes.byteLength > MAX_BYTES) return invalid();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return invalid();
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) return invalid();
  if (text.includes("\r") || !text.startsWith("---\n")) return invalid();
  const closing = text.indexOf("\n---\n", 4);
  if (closing < 0) return invalid();
  const frontmatter = text.slice(4, closing + 1);
  const body = text.slice(closing + 5);
  if (body.length === 0) return invalid();

  const document = parseDocument(frontmatter, {
    schema: "core",
    strict: true,
    uniqueKeys: true,
    keepSourceTokens: true,
  });
  if (document.errors.length !== 0 || document.warnings.length !== 0) return invalid();

  let nodes = 0;
  let unsafe = false;
  visit(document, {
    Node(_key, node, path) {
      nodes += 1;
      if (nodes > MAX_NODES || path.length > MAX_DEPTH || isAlias(node)) unsafe = true;
      if ("anchor" in node && typeof node.anchor === "string") unsafe = true;
      if (
        "tag" in node &&
        typeof node.tag === "string" &&
        !isAcceptedCoreTag(node.tag)
      ) unsafe = true;
      if (isPair(node) && isScalar(node.key) && node.key.value === "<<") unsafe = true;
      if ((isMap(node) || isSeq(node)) && node.items.length > MAX_COLLECTION_ITEMS) unsafe = true;
      if (
        isScalar(node) &&
        typeof node.value === "string" &&
        (!isUnicodeScalarText(node.value) ||
          new TextEncoder().encode(node.value).byteLength > MAX_SCALAR_BYTES)
      ) unsafe = true;
    },
  });
  if (unsafe) return invalid();
  const value: unknown = document.toJS({ maxAliasCount: 0, mapAsMap: false });
  return validateRestrictedOkfSource(value, body);
}
```

The tag authority is a closed `switch`, not a `Set`: freezing a JavaScript
`Set` does not freeze its membership. Tests exercise every accepted literal,
every neighboring/custom tag, and attempts to mutate any exported parser
constant.

This is an intentionally canonical OKF v0.2 enforcement profile: the first
bytes are `---\n`, the closing delimiter is the first later `\n---\n`, line
endings are LF, YAML parsing is applied only to frontmatter, and the remaining
bytes are the Markdown body. A later `---` in the body is ordinary Markdown and
is never reparsed as YAML. The raw digest covers the complete `.md` document,
including both delimiters and the body.

- [ ] **Step 4: Add strict reviewed-JSON parsing**

```ts
import { parse, visit, type ParseError } from "jsonc-parser";

export function parseRestrictedJson(bytes: Uint8Array): RestrictedJsonResult {
  if (bytes.byteLength > 65_536) return invalidJson();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return invalidJson();
  }
  const keys: Set<string>[] = [];
  let invalid = false;
  visit(text, {
    onObjectBegin: () => { keys.push(new Set()); },
    onObjectProperty: (name) => {
      const current = keys.at(-1);
      if (current === undefined || current.has(name)) invalid = true;
      current?.add(name);
    },
    onObjectEnd: () => { keys.pop(); },
    onError: () => { invalid = true; },
  }, { allowTrailingComma: false, disallowComments: true });
  if (invalid || keys.length !== 0) return invalidJson();
  const errors: ParseError[] = [];
  const value: unknown = parse(
    text,
    errors,
    { allowTrailingComma: false, disallowComments: true },
  );
  return errors.length === 0 && validateRestrictedJsonGraph(value)
    ? { ok: true, value: cloneAndDeepFreezeCanonicalJson(value) }
    : invalidJson();
}
```

`cloneAndDeepFreezeCanonicalJson` constructs fresh null-prototype records and
fresh arrays through the validated graph, copies scalar values, and freezes
children before parents. It never returns or freezes the mutable object created
by `jsonc-parser`. Mutation tests retain the parser object and prove later
changes cannot affect the accepted value or canonical bytes.

`validateRestrictedJsonGraph` performs an iterative walk with exact limits:
depth 12, 512 total nodes, 64 members per object/array, and 4,096 UTF-8 bytes per
key/string scalar. It accepts only null, booleans, safe non-negative integers,
Unicode-scalar strings, arrays, and plain records; rejects C0/DEL after escape
decoding, lone surrogates, `__proto__`, `prototype`, `constructor`, exotic
prototypes, accessors, and cycles. Tests reject duplicate keys at every nesting
depth, comments, trailing commas, multiple values, invalid UTF-8, escaped and
raw NUL/control bytes, non-scalar Unicode escapes, prototype keys, and every
limit at `limit + 1`; each exact limit has a passing boundary fixture.

- [ ] **Step 5: Add the strict enforcement-profile validator**

`validateRestrictedOkfSource` requires `type`, exact `resource`,
`status: "stable"`, canonical `stale_after`, non-empty `sources`, human
`verified`, strict `x-okf-datahub-policy`, and a non-empty Markdown body. It
tolerates unknown OKF top-level extension keys only in the build-review
representation and never copies them or body prose to Policy IR.

- [ ] **Step 6: Run parser tests, type checks, and Biome**

Run:

```bash
pnpm exec vitest run packages/policy-compiler/test/restricted-okf.test.ts packages/policy-compiler/test/restricted-json.test.ts
pnpm exec tsc -p packages/policy-compiler/tsconfig.json --noEmit
pnpm exec biome check packages/policy-compiler
```

Expected: PASS for all rejection fixtures and the approved source fixture.

- [ ] **Step 7: Review and commit**

Run the `code-review` skill, then:

```bash
git add -- <every path in the current Delivery row Files cell, and no other path>
test "$(git diff --cached --name-only | LC_ALL=C sort)" = "<that row's sorted path ledger>"
git commit -m "<that row's exact Commit cell>"
```

Execute separately for 4A and 4B; the row Files cell is the staging ledger.

### Task 5: Deterministic policy compiler and reviewed artifacts

**Delivery:** This section is an umbrella only. Deliver these sequential,
non-stacked PR tasks; merge each into `main` before starting the next.

| Task | Branch | Files (exhaustive) | Commit |
|---|---|---|---|
| 5A — governance bootstrap | `build/policy-review-governance` | Create `.github/CODEOWNERS`, `security/policy-protections.v1.json`, `scripts/verify-policy-protections.mjs`, `scripts/test/verify-policy-protections.test.mjs`; modify `security/security-transitions.v1.json` | `build(policy): establish review governance` |
| 5B — reviewed inputs | `feat/reviewed-policy-inputs` | Create `policy/customer-orders.md`, `policy/resource-binding.source.v1.json`, `policy/schema-contract.v1.json`, `packages/policy-compiler/test/golden/schema-contract.v1.canonical.json`, `packages/policy-compiler/test/schema-contract.test.ts` | `feat(policy): add reviewed policy inputs` |
| 5C — provenance | `feat/compiler-provenance-binding` | Create `packages/policy-compiler/src/provenance.ts`, `packages/policy-compiler/src/compiler-artifact.ts`, `packages/policy-compiler/test/provenance.test.ts`; modify `security/security-transitions.v1.json` | `feat(policy-compiler): bind reviewed provenance` |
| 5D — compiler core | `feat/deterministic-policy-core` | Create `packages/policy-compiler/src/compile.ts`, `packages/policy-compiler/test/compile.test.ts`; modify `security/security-transitions.v1.json` | `feat(policy-compiler): compile canonical artifacts` |
| 5E — artifact I/O | `feat/policy-artifact-io` | Create `packages/policy-compiler/src/write-artifacts.ts`, `packages/policy-compiler/src/cli.ts`, `packages/policy-compiler/test/write-artifacts.test.ts`, `scripts/compare-policy-artifacts.mjs`; modify `security/security-transitions.v1.json` | `feat(policy-compiler): validate atomic artifact output` |
| 5F — live review | `feat/live-review-policy-approval` | Create `scripts/compile-reviewed-policy.mjs`, `scripts/test/compile-reviewed-policy.test.mjs`; modify `security/security-transitions.v1.json` | `feat(policy-compiler): verify live policy approval` |
| 5G — protected workflow | `ci/protected-policy-artifacts` | Create `.github/workflows/policy-artifacts.yml`; modify `security/github-actions-uses.v1.json`, `scripts/check-policy-workflow.mjs`, `scripts/test/check-policy-workflow.test.mjs`, `security/security-transitions.v1.json` | `ci(policy): attest reviewed policy artifacts` |
| 5H — attested canary | `test/policy-artifact-canary` | Modify `policy/customer-orders.md` only | `test(policy): exercise protected artifact path` |

Every slice runs `pnpm check`, focused tests, and `code-review`. If a slice
exceeds 220 authored lines after excluding `LLM-CONTRACT` comments, split it
again before review. Stage 2 starts only after 5H and external branch,
CODEOWNERS, environment, artifact, and attestation readback succeed.

**Files:**
- Create: `packages/policy-compiler/src/compile.ts`
- Create: `packages/policy-compiler/src/provenance.ts`
- Create: `packages/policy-compiler/src/compiler-artifact.ts`
- Create: `packages/policy-compiler/src/write-artifacts.ts`
- Create: `packages/policy-compiler/src/cli.ts`
- Create: `packages/policy-compiler/test/compile.test.ts`
- Create: `packages/policy-compiler/test/provenance.test.ts`
- Create: `packages/policy-compiler/test/write-artifacts.test.ts`
- Create: `scripts/compile-reviewed-policy.mjs`
- Create: `scripts/test/compile-reviewed-policy.test.mjs`
- Create: `scripts/compare-policy-artifacts.mjs`
- Create: `.github/workflows/policy-artifacts.yml`
- Modify: `security/github-actions-uses.v1.json`
- Modify: `scripts/check-policy-workflow.mjs`
- Modify: `scripts/test/check-policy-workflow.test.mjs`
- Create: `scripts/verify-policy-protections.mjs`
- Create: `scripts/test/verify-policy-protections.test.mjs`
- Create: `.github/CODEOWNERS`
- Create: `security/policy-protections.v1.json`
- Create: `policy/customer-orders.md`
- Create: `policy/resource-binding.source.v1.json`
- Create: `policy/schema-contract.v1.json`
- Create: `packages/policy-compiler/test/golden/schema-contract.v1.canonical.json`
- Create: `packages/policy-compiler/test/schema-contract.test.ts`
- Modify: `security/security-transitions.v1.json`
- Generate (untracked release output): `dist/policy/policy-ir.v1.json`
- Generate (untracked release output): `dist/policy/resource-bindings.v1.json`
- Generate (untracked release output): `dist/policy/review-attestation.v1.json`
- Generate (untracked release output): `dist/policy/policy-manifest.v1.json`

**Interfaces:**
- Consumes: `CompilePolicyInputs` containing raw policy, binding, schema,
  spec, and compiler bytes plus identities and a branded
  `VerifiedReviewApproval`; no caller may pass a pre-parsed reviewed input.
- Produces: `compilePolicy(inputs): CompilePolicyResult` with four
  byte-identical canonical files and their digests. Only the protected workflow
  may construct `VerifiedReviewApproval` from a live GitHub API response; no
  repository JSON file is an approval authority.

- [ ] **Step 1: Add the approved OKF source exactly**

```markdown
---
type: "Data Usage Policy"
resource: "urn:li:dataset:(urn:li:dataPlatform:postgres,demo.analytics.customer_orders,PROD)"
status: "stable"
stale_after: "2027-01-01"
sources:
  - resource: "repo://governance/privacy/customer-orders"
verified:
  - by: "human:data-governance"
    at: "2026-07-20T09:00:00Z"
x-okf-datahub-policy:
  version: 1
  policy_id: "customer-orders-v1"
  expires_at: "2026-12-31T23:59:59Z"
  default: "DENY"
  fields:
    customer_id: {project: ALLOW, filter: [EQ]}
    email: {project: DENY, filter: DENY}
    total: {project: ALLOW, filter: [EQ, LT, LTE, GT, GTE]}
    status: {project: ALLOW, filter: [EQ]}
    placed_on: {project: ALLOW, filter: [EQ, LT, LTE, GT, GTE]}
---
# Usage rule

Customer email addresses must not appear in analytical projections or filter
values. Only the five frontmatter field rules above are executable policy; this
body is human-reviewed explanation and is never interpreted by the runtime.
```

The reviewed schema contract is exactly:

```json
{
  "apiVersion": "postgres-schema/v1",
  "database": "demo",
  "databaseProperties": {
    "encoding": "UTF8",
    "collation": "C",
    "ctype": "C"
  },
  "schema": "analytics",
  "relation": "customer_orders",
  "owner": "demo_owner",
  "relationKind": "TABLE",
  "accessMethod": "heap",
  "persistence": "PERMANENT",
  "rowSecurity": false,
  "forceRowSecurity": false,
  "hasRules": false,
  "hasUserTriggers": false,
  "hasChildren": false,
  "isPartition": false,
  "inheritParents": [],
  "columns": [
    {"ordinal": 1, "name": "customer_id", "type": "text", "notNull": true, "collation": "C", "defaultExpression": null, "generated": false, "identity": "NONE"},
    {"ordinal": 2, "name": "email", "type": "text", "notNull": true, "collation": "C", "defaultExpression": null, "generated": false, "identity": "NONE"},
    {"ordinal": 3, "name": "total", "type": "numeric(12,2)", "notNull": true, "collation": null, "defaultExpression": null, "generated": false, "identity": "NONE"},
    {"ordinal": 4, "name": "status", "type": "text", "notNull": true, "collation": "C", "defaultExpression": null, "generated": false, "identity": "NONE"},
    {"ordinal": 5, "name": "placed_on", "type": "date", "notNull": true, "collation": null, "defaultExpression": null, "generated": false, "identity": "NONE"}
  ],
  "constraints": [
    {
      "name": "customer_orders_customer_id_octets_ck",
      "kind": "CHECK",
      "definition": "CHECK ((octet_length(customer_id) <= 64))"
    },
    {
      "name": "customer_orders_customer_id_format_ck",
      "kind": "CHECK",
      "definition": "CHECK ((customer_id ~ '^cust_[0-9]{3,12}$'::text))"
    },
    {
      "name": "customer_orders_customer_id_unique",
      "kind": "UNIQUE",
      "definition": "UNIQUE (customer_id)"
    },
    {
      "name": "customer_orders_status_ck",
      "kind": "CHECK",
      "definition": "CHECK ((status = ANY (ARRAY['PENDING'::text, 'PAID'::text, 'CANCELLED'::text])))"
    },
    {
      "name": "customer_orders_total_nonnegative_ck",
      "kind": "CHECK",
      "definition": "CHECK ((total >= (0)::numeric))"
    }
  ],
  "indexes": [
    {
      "name": "customer_orders_customer_id_unique",
      "method": "btree",
      "unique": true,
      "valid": true,
      "ready": true,
      "columns": ["customer_id"],
      "predicate": null,
      "expression": null
    }
  ],
  "executorRole": {
    "name": "okf_query_executor",
    "login": true,
    "superuser": false,
    "createdb": false,
    "createrole": false,
    "inherit": false,
    "replication": false,
    "bypassRls": false,
    "connectionLimit": 1,
    "memberships": [],
    "settings": {
      "default_transaction_read_only": "on",
      "statement_timeout": "3000ms",
      "lock_timeout": "250ms",
      "transaction_timeout": "5000ms",
      "idle_in_transaction_session_timeout": "2000ms",
      "search_path": "pg_catalog",
      "row_security": "on"
    }
  },
  "acl": {
    "database": {
      "executor": {"connect": true, "create": false, "temporary": false},
      "public": {"connect": false, "create": false, "temporary": false}
    },
    "schemas": {
      "analytics": {
        "executor": {"usage": true, "create": false},
        "public": {"usage": false, "create": false}
      },
      "public": {
        "executor": {"usage": false, "create": false},
        "public": {"usage": false, "create": false}
      }
    },
    "relation": {
      "tablePrivileges": [],
      "columnSelect": ["customer_id", "total", "status", "placed_on"],
      "publicPrivileges": []
    },
    "analyticsRoutines": {
      "executorExecute": false,
      "publicExecute": false
    },
    "monitoring": {
      "executor": {
        "schemaUsage": false,
        "tableSelect": false,
        "functionExecute": false
      },
      "public": {
        "schemaUsage": false,
        "tableSelect": false,
        "functionExecute": false
      }
    }
  },
  "extensions": [
    {
      "name": "pg_stat_statements",
      "version": "1.12",
      "schema": "okf_monitor",
      "executorAccessible": false
    },
    {
      "name": "plpgsql",
      "version": "1.0",
      "schema": "pg_catalog",
      "executorAccessible": false
    }
  ]
}
```

The canonical file contains exactly 3,237 UTF-8 bytes with no final LF.
`SHA-256(ASCII("postgres-schema/v1") || NUL || canonical bytes)` must equal
`sha256:87227d948568792ada19921a614fcb8517c27e71629bc82babf3b6fa073308c3`.
The golden test parses the reviewed JSON bytes through both restricted JSON and
`schemaContractSchema`, compares exact canonical bytes with the checked-in
golden, compares the digest with this literal, and proves
`buildResourceBinding` embeds it. It also boots PostgreSQL 18.4 with exact
UTF8/C locale and requires the named constraints/index,
column/default/generated/
identity/collation projection, role flags/membership/settings, ownership,
database/schema/table/column/routine/monitoring ACLs for both the executor and
`PUBLIC`, partition/inheritance parents, and extensions to equal the contract.
Grant drift for either principal is independently tested. Any
version-dependent difference is `NO-GO`, not normalization by guess.

- [ ] **Step 2: Write reproducibility and completeness tests**

```ts
it("emits the same four byte streams twice", async () => {
  const first = await compileFixture();
  const second = await compileFixture();
  expect(first.files).toEqual(second.files);
});

it("uses the exact-date UTC stale boundary", async () => {
  const result = await compileFixture();
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const policy = parsePolicyIrFile(
    new TextEncoder().encode(
      requireArtifact(result.files, "policy-ir.v1.json").canonicalText,
    ),
  );
  expect(policy.effectiveExpiresAt).toBe("2026-12-31T23:59:59Z");
});

it("requires one explicit rule for every bound field", async () => {
  const inputs = await fixtureInputsWithoutRule("email");
  expect(compilePolicy(inputs)).toEqual({
    ok: false,
    code: "POLICY_SOURCE_INVALID",
  });
});

it("rejects approval JSON supplied by the checkout", async () => {
  await expect(
    compileReviewedCheckout(fakeGitHub(), {
      repositoryApprovalPath: "policy/review-approval.v1.json",
    }),
  ).rejects.toThrow("repository approval inputs are forbidden");
});

it.each([
  "reviewer-not-allowlisted",
  "review-commit-mismatch",
  "latest-review-not-approved",
  "policy-path-not-in-reviewed-diff",
  "compiler-output-byte-mutated",
  "artifact-substituted-between-compile-and-write",
])("rejects untrusted review state: %s", async (failure) => {
  await expect(compileReviewedCheckout(fakeGitHub(failure))).rejects.toThrow();
});
```

- [ ] **Step 3: Run tests and verify the compiler is missing**

Run: `pnpm exec vitest run packages/policy-compiler/test/compile.test.ts`

Expected: FAIL with missing `compilePolicy`.

- [ ] **Step 4: Implement normalization and digest binding**

```ts
export type CompilePolicyInputs = Readonly<{
  policySource: Readonly<{
    repository: string;
    repositoryId: string;
    path: string;
    commit: string;
    bytes: Uint8Array;
  }>;
  okfSpec: Readonly<{
    repository: "GoogleCloudPlatform/knowledge-catalog";
    path: "okf/SPEC.md";
    commit: "3fcbb9f828c2f23d109c855ee403c3a4c81f3a96";
    bytes: Uint8Array;
  }>;
  compiler: Readonly<{
    name: "@okf-datahub/policy-compiler";
    version: "0.1.0";
    artifact: VerifiedCompilerArtifact;
  }>;
  bindingSource: Readonly<{
    path: "policy/resource-binding.source.v1.json";
    bytes: Uint8Array;
  }>;
  schemaContract: Readonly<{
    path: "policy/schema-contract.v1.json";
    bytes: Uint8Array;
  }>;
  approval: VerifiedReviewApproval;
}>;

export function compilePolicy(inputs: CompilePolicyInputs): CompilePolicyResult {
  const owned = copyCompilePolicyInputs(inputs);
  const provenance = verifyCompileProvenance(owned);
  if (!provenance.ok) return provenance;
  const source = parseRestrictedOkf(owned.policySource.bytes);
  if (!source.ok) return source;
  const bindingJson = parseRestrictedJson(owned.bindingSource.bytes);
  if (!bindingJson.ok) return bindingJson;
  const bindingSource = parseResourceBindingSource(bindingJson.value);
  if (!bindingSource.ok) return bindingSource;
  const schemaJson = parseRestrictedJson(owned.schemaContract.bytes);
  if (!schemaJson.ok) return schemaJson;
  const schemaContract = parseSchemaContract(schemaJson.value);
  if (!schemaContract.ok) return schemaContract;
  const schemaContractDigest =
    canonicalSha256("postgres-schema/v1", schemaContract.value);
  const binding =
    buildResourceBinding(bindingSource.value, schemaContractDigest);
  const policyIr = buildPolicyIr(source.value);
  const policyDigest = canonicalSha256("policy-ir/v1", policyIr);
  const bindingDigest = canonicalSha256("resource-binding/v1", binding);
  const tuple = bindVerifiedArtifactTuple({
    provenance: provenance.value,
    approval: owned.approval,
    policyDigest,
    bindingDigest,
  });
  if (!tuple.ok) return tuple;
  const attestation = buildReviewAttestation(tuple.value);
  const manifestTuple = bindVerifiedManifestTuple({
    provenance: provenance.value,
    policyDigest,
    bindingDigest,
    attestationDigest:
      canonicalSha256("review-attestation/v1", attestation),
  });
  if (!manifestTuple.ok) return manifestTuple;
  return canonicalArtifactSet(
    policyIr,
    binding,
    attestation,
    buildManifest(manifestTuple.value),
  );
}
```

`minimumUtcTimestamp` must compare parsed instants but emit the original canonical UTC string. It returns `2026-12-31T23:59:59Z` for this policy because the OKF stale boundary is `2027-01-01T00:00:00Z`.

`compilePolicy` copies every raw input at entry before validation.
`writeArtifactSetAtomically` accepts only the frozen four-element success
tuple, re-encodes each immutable `canonicalText`, checks `byteLength`, reparses
the exact bytes through the named closed schema, recomputes the domain digest,
then writes/fsyncs the new temporary file. It performs the same verification on
the bytes read back from each file immediately before the single directory
rename and fsyncs the parent. A mutation/substitution between compile and
write, a stale paired digest, or a short write fails and removes the temporary
directory; no partially trusted destination remains.

`verifyCompileProvenance` computes every raw digest internally; callers cannot
supply a digest. It requires the fixed OKF repository/path/commit/digest tuple,
the protected workflow's immutable repository ID, canonical source/compiler
identities, and
`approval.repositoryId/commit === policySource.repositoryId/commit`. Before
branding the tuple, the workflow proves every policy, binding, schema, compiler,
workflow, and CODEOWNERS authority exists at the reviewed commit. Every one
whose head blob differs from the trusted PR base must appear in the complete
reviewed changed-file set; unchanged authority files are not required to be
meaninglessly edited.
`VerifiedArtifactTuple` carries the full source/spec/compiler identities and
computed digests into both attestation and manifest builders. Generation ends
by reparsing all four canonical byte streams and rechecking every cross-link.

`VerifiedCompilerArtifact` is not an arbitrary blob. The protected workflow
performs two clean builds, then uses `pnpm deploy --prod --legacy` to construct
an isolated compiler runtime closure. It verifies the two closures
byte-for-byte and walks exactly:

```text
package.json
tsconfig.base.json
flake.lock
pnpm-lock.yaml
packages/contracts/package.json
packages/contracts/tsconfig.json
packages/contracts/dist/**/*.js
packages/contracts/dist/**/*.d.ts
packages/policy-compiler/package.json
packages/policy-compiler/tsconfig.json
packages/policy-compiler/dist/**/*.js
packages/policy-compiler/dist/**/*.d.ts
work/compiler-closure/node_modules/**/*
work/compiler-toolchain.v1.json
```

`compiler-toolchain.v1.json` contains only the exact Node, pnpm, TypeScript,
Nixpkgs revision, `flake.lock` digest, and `pnpm-lock.yaml` digest already
validated by Task 1. The deployed closure includes the exact production copies
of Zod, YAML, `jsonc-parser`, contracts, and every transitive executable
dependency; a lock entry without matching installed bytes is insufficient.

Deployment fixes `node-linker=hoisted` and `package-import-method=copy`.
The walker rejects maps, missing files, unallowlisted extensions, sockets,
devices, FIFOs, duplicate/case-colliding paths, and entries outside the
closure; normalizes paths to repository-relative POSIX strings; and sorts by
raw UTF-8 path bytes. A regular member uses the exact shape below.

```json
{
  "apiVersion": "compiler-artifact/v1",
  "files": [
    {
      "path": "packages/policy-compiler/dist/compile.js",
      "byteLength": 1,
      "rawDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  ],
  "toolchain": {
    "node": "24.18.0",
    "pnpm": "11.17.0",
    "typescript": "7.0.2"
  }
}
```

The only symlinks accepted are relative executable links under the deployed
closure's fixed `.bin` directories. Their manifest member is exactly
`{"kind":"symlink","path":"…","target":"…"}`. The verifier bounds target
length and chain depth, rejects absolute targets, cycles, escapes after
normalization, and links whose final regular target is not separately present
and hashed in the same manifest. Link text and the final target bytes are thus
both bound. Every other symlink is `COMPILER_ARTIFACT_INVALID`.

The private workflow constructor validates the complete manifest and returns
`VerifiedCompilerArtifact`; `compilePolicy` hashes it with domain
`compiler-artifact/v1`. A one-byte mutation to contracts output, compiler
output, installed dependency, root/build config, lock, declaration, toolchain
identity, path, or manifest member must change the digest or fail compilation.
Source changes are trusted through the reviewed commit and must either produce
the same executable closure in both clean builds or a new digest. No
caller-provided compiler byte array or digest is accepted.

- [ ] **Step 5: Add the protected live-review compiler**

`.github/CODEOWNERS` assigns `.github/workflows/**`,
`scripts/compile-reviewed-policy.mjs`, `packages/policy-compiler/**`, and
`policy/**` to the governance team. The branch requires that CODEOWNER's review,
and the `policy-production` environment independently stores the allowlisted
GitHub reviewer logins. Neither protection is writable by the release job.

Task 5A merges `.github/CODEOWNERS` before any governed input exists. It maps
`.github/workflows/**`, `.github/CODEOWNERS`, `policy/**`, compiler authority,
the workflow action allowlist/checker, and all security registries/checkers to
the governance team. `verify-policy-protections.mjs` uses read-only GitHub APIs to
require the fixed repository ID, protected `main`, required code-owner review,
dismiss-stale-review and last-push-approval rules, no force push/deletion, and
the protected `policy-production` environment with the independent reviewer
allowlist. The 5A PR may merge only after live readback proves those controls;
5B therefore receives CODEOWNER enforcement from its base branch.

The 5G workflow runs only for an `APPROVED` `pull_request_review`, checks out the
exact `github.event.review.commit_id`, and invokes:

```bash
pnpm --filter @okf-datahub/policy-compiler build
node scripts/compile-reviewed-policy.mjs \
  --pull-request "$POLICY_PULL_REQUEST" \
  --reviewed-commit "$POLICY_REVIEWED_COMMIT" \
  --output dist/policy
```

`compile-reviewed-policy.mjs`:

1. requires `GITHUB_ACTIONS=true`, the protected `policy-production`
   environment, and a read-only GitHub token;
2. requires `git rev-parse HEAD`, the PR head SHA, and the review's `commit_id`
   to equal `POLICY_REVIEWED_COMMIT`;
3. requires the GitHub API repository ID to equal the immutable
   `GITHUB_REPOSITORY_ID`;
4. fetches all PR reviews, reduces them to the latest state per reviewer, and
   requires one latest `APPROVED` review at that exact commit from the
   environment allowlist;
5. fetches every PR changed-file page and the base/head Git trees from the
   GitHub API, requires all policy/binding/schema/compiler/workflow/CODEOWNERS
   authorities to exist at the exact reviewed head, and requires every critical
   path whose blob differs from the trusted base to be present in the reviewed
   changed-file set; at least one governed input or compiler path must change,
   while unchanged authorities need not appear; pagination truncation, rename
   ambiguity, base mismatch, or an unreported changed blob fails;
6. constructs `VerifiedReviewApproval` in memory from repository ID, PR number,
   review database ID, reviewer login, submission time, and reviewed commit;
7. calls `compilePolicy` in the same process, writes through a newly created
   temporary directory, validates all four files, and renames them atomically.

The script has no `--approval` option and rejects repository approval JSON.
`dist/policy` is ignored by Git and exists only as protected build output. The
workflow static gate requires every action to use the exact SHA in
`security/github-actions-uses.v1.json`. The build job has only
`contents: read` and `pull-requests: read`, receives the read-only compiler API
token, builds twice, compares, and uploads exactly the four named files. A
separate attestation job receives no compiler API token, downloads the
run-scoped artifact by immutable ID, revalidates its four-file digest ledger,
and alone receives `actions: read`, `contents: read`, `id-token: write`, and
`attestations: write`; all unspecified permissions are `none`. It creates GitHub build
provenance attestations over each file digest. Downstream image construction
downloads them into a new empty directory and verifies all four attestations
before Docker receives the build context. Identical policy/compiler/review
tuples produce byte-identical artifacts; no build timestamp is written.

Task 5H changes only the final human Markdown sentence in
`policy/customer-orders.md`; executable frontmatter and expected Policy IR stay
byte-identical while the source, attestation, and manifest digests change. The
branch is locally squashed to its one named commit before final approval. After
the successful protected run, it is merged with a merge commit that preserves
the approved head SHA as an ancestor; post-approval pushes, GitHub squash, and
rebase merge are forbidden. Readback verifies the exact workflow run database
ID, reviewed commit, artifact ID, four subject digests, and attestations before
Stage 2 starts.

- [ ] **Step 6: Run mutation, determinism, and package gates**

Run:

```bash
pnpm install --frozen-lockfile
pnpm exec vitest run packages/policy-compiler/test --maxWorkers=1
pnpm exec tsc -p packages/policy-compiler/tsconfig.json --noEmit
pnpm exec biome check packages/policy-compiler policy
node scripts/compile-reviewed-policy.mjs \
  --pull-request "$POLICY_PULL_REQUEST" \
  --reviewed-commit "$POLICY_REVIEWED_COMMIT" \
  --output work/policy-build-a
node scripts/compile-reviewed-policy.mjs \
  --pull-request "$POLICY_PULL_REQUEST" \
  --reviewed-commit "$POLICY_REVIEWED_COMMIT" \
  --output work/policy-build-b
node scripts/compare-policy-artifacts.mjs \
  work/policy-build-a work/policy-build-b
```

Expected: PASS; every single-byte source or artifact mutation changes a bound
digest or makes compilation fail, and a checked-in/self-authored approval can
never construct `VerifiedReviewApproval`.

- [ ] **Step 7: Review and merge each mandatory slice**

For each row, run its focused tests plus `pnpm check`, invoke the
`code-review` skill, inspect any normalized Policy IR change by hand, commit
only that row's exclusive files with its named commit, merge, update `main`,
and continue. Do not combine or stack the slices.

## Plan Completion Gate

Run:

```bash
nix develop -c pnpm install --frozen-lockfile
nix develop -c pnpm toolchain:check
nix develop -c pnpm tcb:check
nix develop -c pnpm check
nix develop -c pnpm test
git diff --check
```

In the protected policy workflow, also run the two fresh-output compile and
`compare-policy-artifacts.mjs` sequence from Step 6 before upload. The comparer
requires exactly four filenames, byte-for-byte equality, canonical schemas and
all cross-links; local unit fixtures run the same comparer without constructing
a production approval. Expected: all commands pass; `dist/policy` is
reproducible and runtime packages can consume it without importing `yaml` or
`@okf-datahub/policy-compiler`.
