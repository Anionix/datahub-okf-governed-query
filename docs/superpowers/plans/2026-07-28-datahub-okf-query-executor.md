# DataHub OKF Query Executor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the isolated fail-closed executor that verifies policy and live PostgreSQL state, compiles a closed typed query, validates bounded results, confirms rollback, and only then releases a response.

**Architecture:** `query-executor` accepts four closed variants over a Unix-domain socket and has no DataHub or MCP dependency. Policy permission creates only a pending state; an unforgeable authorization value is created after a lock-held live-schema check, then one generated `SELECT` executes through the column-restricted PostgreSQL role.

**Tech Stack:** TypeScript 7.0.2, Zod 4.4.3, Node.js 24.18.0, node-postgres 8.22.0, pg-cursor 2.21.0, PostgreSQL 18.4, Lean 4.32.1

## Global Constraints

- Implement the approved strict design; arbitrary SQL, additional datasets, real data, DataHub clients, MCP SDK, YAML, policy hot reload, HTTP, and writeback are forbidden.
- Use one branch and one task per PR, target 150–220 changed lines excluding `LLM-CONTRACT` comments, and run the `code-review` skill before every PR.
- A numbered section with a mandatory `Delivery` table is an umbrella work
  package, not a PR. Each table row is the actual task/branch/PR; a combined
  umbrella PR is forbidden. Unsliced numbered sections remain one task/PR.
- `query-executor` has no DataHub token/route, MCP SDK, YAML parser, compiler, shell, or package manager in its runtime closure.
- Every socket request and artifact begins as `unknown` and passes a strict closed validator; no coercion, `any`, unsafe assertion, non-null assertion, ignored diagnostic, or raw exception crosses a boundary.
- Policy integrity and freshness run on every request. Effective expiry is `min(stale_after at exact-date 00:00:00Z, expires_at)` and must be later than trusted time plus uncertainty plus 5,000 ms.
- `verified` is never authorization. Trust derives from exact manifest, artifact, compiler, OKF spec, source, and protected review-attestation digests.
- `PolicyAllowedPendingSchema` cannot open an application query. Only `DB_SCHEMA_VERIFIED` can create `SchemaVerifiedAuthorization`.
- The `email + EQ + {"type":"PROHIBITED"}` input always returns `FIELD_USE_DENIED` before `POLICY_ALLOWED_PENDING_SCHEMA` and causes zero database checkout/application-query transitions.
- Use one pool connection and one active execution. Every statement in a request uses the same checked-out client and one `REPEATABLE READ READ ONLY` transaction.
- Do not use `LOCK TABLE`; the first transaction `SELECT` is the fixed `customer_id ... WHERE false` lock primer, which acquires `AccessShareLock` under column ACL.
- Buffer and validate the complete bounded result, confirm `ROLLBACK`, and only then create a releasable success. On uncertain rollback destroy the client and discard all rows.
- Request frame maximum: 32,768 bytes; response frame maximum: 327,680 bytes; result JSON maximum: 262,144 bytes; maximum 5 columns and 100 returned rows.
- Put an exact `LLM-CONTRACT` accepted-state/emitted-state/failure-state/invariant comment on each transition.

---

## Dependency Order

This is the second Stage 2 lane. Start only after all foundation/policy tasks
are merged and context Task 1 has established the Stage 2 shared-root scaffold.
Query Task 1 starts from that merged `main`, regenerates `pnpm-lock.yaml`, and
then Tasks 1–3, 4A–4C, 5–7, 8A–8D, and 9–10 proceed in order. App-owned work may
proceed in parallel with the context lane, but both lanes modify the shared
transition registry. Final PR merges are therefore serialized: before final
review, each branch incorporates current `main`, regenerates any touched lock,
runs all shared gates, and receives fresh review for the resulting commit.
Integration starts only after both lanes merge.

At the start of every query branch and clean CI job, run
`pnpm install --frozen-lockfile` followed by
`pnpm --filter @okf-datahub/contracts build`. Ignored contract `dist` output is
never assumed to exist from a prior branch or worktree.

---

## Closed Type and State Ledger

Every value below is nominal, deeply frozen at runtime, and has a private
constructor. Only the named owner transition may construct it. Parsers,
dispatchers, tests, object literals, deserializers, and type assertions cannot
forge one. Every fallible transition returns a closed union; raw exceptions and
input-derived messages stay private.

```ts
type StageResult<T, C extends string> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; reasonCode: C }>;

type TransactionFailureCode = "RESOURCE_BUSY" | "INTERNAL_FAILURE";
type SchemaAuthorizationFailureCode =
  | "DB_SCHEMA_MISMATCH"
  | "INTERNAL_FAILURE";
type CompilationFailureCode = "INTERNAL_FAILURE";
type ExecutionFailureCode =
  | "EXECUTION_TIMEOUT"
  | "OUTPUT_INVALID"
  | "INTERNAL_FAILURE";
type PostBeginFailureCode =
  | "POLICY_EXPIRED"
  | "RESOURCE_BUSY"
  | "DB_SCHEMA_MISMATCH"
  | ExecutionFailureCode;
type QueryRejectionCode = PostBeginFailureCode;

declare class PolicyFreshnessDeadline {
  private constructor();
  readonly effectiveExpiryUnixMilliseconds: number;
  readonly latestStartMonotonicMilliseconds: number;
  static verifyAndCreate(
    effectiveExpiryUnixMilliseconds: number,
    clock: ClockReading,
  ): StageResult<PolicyFreshnessDeadline, "POLICY_EXPIRED">;
}

declare class ExecutionDeadline {
  private constructor();
  readonly expiresAtMonotonicMilliseconds: number;
  static fromAdmission(
    acceptedAtMonotonicMilliseconds: number,
  ): StageResult<ExecutionDeadline, "INTERNAL_FAILURE">;
}

declare class BeginFreshnessLease {
  private constructor();
  static revalidateAndCreate(
    deadline: PolicyFreshnessDeadline,
    clock: ClockReading,
    executionDeadline: ExecutionDeadline,
    signal: AbortSignal,
  ): StageResult<BeginFreshnessLease, "POLICY_EXPIRED" | "INTERNAL_FAILURE">;
}

declare class ApplicationQueryFreshnessLease {
  private constructor();
  static revalidateAndCreate(
    deadline: PolicyFreshnessDeadline,
    clock: ClockReading,
    executionDeadline: ExecutionDeadline,
    signal: AbortSignal,
  ): StageResult<
    ApplicationQueryFreshnessLease,
    "POLICY_EXPIRED" | "INTERNAL_FAILURE"
  >;
}

type EvaluatedQueryPlanPayload = DeepReadonly<{
  operationId: OperationId;
  request: GovernedQueryInputV1;
  datahubContextDigest: Sha256Digest;
  policyDigest: Sha256Digest;
  bindingDigest: Sha256Digest;
  schemaContractDigest: Sha256Digest;
  authorizedProjection: readonly SafeFieldId[];
  authorizedPredicates: readonly AuthorizedPredicate[];
  policyFreshnessDeadline: PolicyFreshnessDeadline;
}>;

type CompiledSelectPayload = DeepReadonly<{
  text: string;
  values: readonly [...predicateValues: string[], limitPlusOne: number];
  resultColumns: readonly ResultColumnDescriptor[];
  requestedLimit: number;
}>;

type ComparisonOperator = "EQ" | "LT" | "LTE" | "GT" | "GTE";
type AuthorizedPredicate =
  | Readonly<{
      fieldId: "customer_id";
      operator: "EQ";
      valueType: "OPAQUE_ID";
      value: string;
    }>
  | Readonly<{
      fieldId: "total";
      operator: ComparisonOperator;
      valueType: "DECIMAL";
      value: string;
    }>
  | Readonly<{
      fieldId: "status";
      operator: "EQ";
      valueType: "ENUM";
      value: string;
    }>
  | Readonly<{
      fieldId: "placed_on";
      operator: ComparisonOperator;
      valueType: "DATE";
      value: string;
    }>;

type ResultColumnDescriptor =
  | Readonly<{ fieldId: "customer_id"; type: "OPAQUE_ID" }>
  | Readonly<{ fieldId: "total"; type: "DECIMAL" }>
  | Readonly<{ fieldId: "status"; type: "ENUM" }>
  | Readonly<{ fieldId: "placed_on"; type: "DATE" }>;

type CompletedQueryExecution = DeepReadonly<{
  status: "COMPLETED";
  decision: "ALLOW";
  reasonCodes: readonly ["POLICY_ALLOWED"];
  columns: readonly ResultColumnDescriptor[];
  rows: readonly (readonly string[])[];
  truncated: boolean;
}>;

type CleanupDisposition = "NO_TRANSACTION" | "ROLLED_BACK" | "CLIENT_DESTROYED";
type RejectedQueryExecution<C extends QueryRejectionCode> = Readonly<{
  status: "REJECTED";
  decision: "DENY";
  reasonCodes: readonly [C];
  cleanup: CleanupDisposition;
}>;

type QueryExecutionOutcome =
  | CompletedQueryExecution
  | RejectedQueryExecution<QueryRejectionCode>;

declare class RollbackPendingFailure<C extends PostBeginFailureCode> {
  private constructor();
  readonly reasonCode: C;
  readonly operationId: OperationId;
}

declare class RollbackConfirmed {
  private constructor();
  readonly operationId: OperationId;
}
```

These arrays are additionally bounded and deeply frozen by their closed
schemas. Predicate values and returned cell strings retain the exact
type-specific runtime validators and length bounds from the contracts package.
The final numeric
parameter is the internally derived safe integer `requestedLimit + 1` in
`2..101`; no input number or earlier numeric parameter is accepted. `text` is internal and
can be created only by the closed compiler map, never parsed or accepted at a
boundary.

| Value | Exact sealed payload | Sole constructor owner | Failure union |
|---|---|---|---|
| `EvaluatedQueryPlan` | `EvaluatedQueryPlanPayload` | `evaluateIntent(ResourceVerified)` in `policy/evaluate-intent.ts`; it is immediately enclosed in `PolicyAllowedPendingSchema` | `PolicyEvaluationResult` |
| `DbRelationLocked` | private checked-out client/transaction identity, relation OID, boot schema digest, and lock-primer completion token | `markRelationLocked` in `db/transaction-state.ts`, after the fixed primer resolves | `StageResult<DbRelationLocked, TransactionFailureCode>` |
| `DbSchemaVerified` | the same lock-held transaction identity, relation OID, boot digest, and equal live digest | `verifyLockedSchema(DbRelationLocked)` in `db/transaction-state.ts` | `StageResult<DbSchemaVerified, SchemaAuthorizationFailureCode>` |
| `SchemaVerifiedAuthorization` | `DbSchemaVerified` plus the exact pending plan for the same binding/schema digest | `authorizeVerifiedSchema(DbSchemaVerified, PolicyAllowedPendingSchema)` in `db/transaction-state.ts` | `StageResult<SchemaVerifiedAuthorization, SchemaAuthorizationFailureCode>` |
| `CompiledSelect` | `CompiledSelectPayload` | `compileAuthorizedQuery` in `sql/compiler.ts` | `StageResult<CompiledSelect, CompilationFailureCode>` |
| `BufferedExecutionResult` | private validated row buffer, exact columns, serialized byte count, and truncation bit; no row getter | `validateAndSealRows` in `output/result-buffer.ts` | `StageResult<BufferedExecutionResult, "OUTPUT_INVALID">` |
| `OutputValidatedTransaction` | the same transaction identity plus its sealed buffer | `bindValidatedOutput` in `execution/governed-query.ts` | `StageResult<OutputValidatedTransaction, "INTERNAL_FAILURE">` |
| `QueryExecutionOutcome` | the exact closed union above | completed variant only from `releaseValidatedOutput(transaction, RollbackConfirmed)`; rejected variant only from `finalizeRejectedAfterCleanup` | no raw exception |

After `BEGIN`, every timeout, live-schema drift, lock failure, output failure,
freshness expiry, or internal failure is held only as
`RollbackPendingFailure<C>` together with its private transaction and pending
fixed reason. It is not a `QueryExecutionOutcome`. Successful rollback creates
a private `RollbackConfirmed` token and releases either the buffered success or
pending fixed rejection. Uncertain rollback destroys the client, discards all
rows, and replaces the pending reason with `INTERNAL_FAILURE`. No public
zero-argument `releaseAfterRollback()` or row-buffer getter exists.

---

## Key File Map (non-exhaustive)

The per-task `Files` lists are exhaustive and authoritative; this map only
shows the paths most useful for orientation.

```text
apps/query-executor/package.json                  runtime dependencies only
apps/query-executor/src/policy/policy-store.ts    immutable verified artifact set
apps/query-executor/src/policy/freshness.ts       exact UTC expiry gate
apps/query-executor/src/state/preflight.ts        policy/context state machine
apps/query-executor/src/transport/frame-codec.ts  bounded UDS framing
apps/query-executor/src/transport/uds-server.ts   single-request socket server
apps/query-executor/src/db/pool.ts                 one-connection fixed pool
apps/query-executor/src/db/type-parsers.ts         fixed text-only pg parsers
apps/query-executor/src/db/role-attestation.ts    principal/ACL checks
apps/query-executor/src/db/schema-attestation.ts  portable/live schema checks
apps/query-executor/src/db/transaction.ts         lock-first transaction lifecycle
apps/query-executor/src/sql/compiler.ts            closed SQL generator
apps/query-executor/src/output/validator.ts        strict database cells
apps/query-executor/src/output/result-buffer.ts    bounded private row buffer
apps/query-executor/src/execution/governed-query.ts rollback-before-release flow
apps/query-executor/src/dispatcher.ts              two-operation dispatcher
apps/query-executor/src/main.ts                    readiness and startup
infra/postgres/init/*                              synthetic table and role wrapper
infra/postgres/sql/monitoring.sql                  admin-only query counter
formal/ExecutorState.lean                          control-flow proofs
apps/query-executor/test/**                        unit/property/privilege tests
```

### Task 1: Runtime artifact store and exact freshness

**Branch:** `feat/executor-policy-store`

**Commit:** `feat(query-executor): verify pinned policy snapshots`

**Files:**
- Create: `apps/query-executor/package.json`
- Create: `apps/query-executor/tsconfig.json`
- Create: `apps/query-executor/tsconfig.test.json`
- Create: `apps/query-executor/src/policy/load-artifacts.ts`
- Create: `apps/query-executor/src/policy/policy-store.ts`
- Create: `apps/query-executor/src/policy/freshness.ts`
- Create: `apps/query-executor/src/time/trusted-clock.ts`
- Create: `apps/query-executor/test/policy/policy-store.test.ts`
- Create: `apps/query-executor/test/policy/freshness.test.ts`
- Create: `apps/query-executor/test/fixtures/policy-valid/*.json`
- Modify: `tsconfig.json`
- Modify: `pnpm-lock.yaml`
- Modify: `security/security-transitions.v1.json`

**Interfaces:**
- Consumes: four read-only canonical artifact files and a `ClockReading`.
- Produces: `PolicyStore.load`, `verifyIntegrityForRequest`, `verifyPolicyFreshness`, `policySummary`, and `resourceBinding`.

`PolicyStore.load` requires
`reviewAttestation.approvalId ===
"github-review:" + reviewAttestation.review.reviewDatabaseId`. Its private
`policySummary` copies that exact validated `approvalId`; no other layer may
construct or rewrite it.

- [ ] **Step 1: Create a runtime-only package**

```json
{
  "name": "@okf-datahub/query-executor",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@okf-datahub/contracts": "workspace:*",
    "pg": "8.22.0",
    "pg-cursor": "2.21.0",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@types/node": "24.13.3",
    "@types/pg": "8.20.0",
    "@types/pg-cursor": "2.7.2"
  },
  "scripts": {
    "build": "tsc -b",
    "check": "tsc --noEmit",
    "test": "vitest run --exclude '**/*.integration.test.ts' --maxWorkers=1"
  }
}
```

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "tsBuildInfoFile": "dist/query-executor.tsbuildinfo"
  },
  "references": [{"path": "../../packages/contracts"}],
  "include": ["src/**/*.ts"]
}
```

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "composite": false
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Add `{"path":"./apps/query-executor"}` to the root `tsconfig.json` references.

- [ ] **Step 2: Write integrity mutation and freshness-boundary tests**

```ts
it.each(["policyIr", "binding", "attestation", "manifest"])(
  "rejects one-byte %s mutation on every request",
  async (name) => {
    const store = await loadValidStore();
    await mutateFixtureByteInPlace(name);
    expect(await store.verifyIntegrityForRequest()).toEqual({
      ok: false, reasonCode: "POLICY_INTEGRITY_FAILED",
    });
  },
);

it.each([
  ["2026-12-31T23:59:52.999Z", 1_000, true],
  ["2026-12-31T23:59:54.000Z", 1_000, false],
  ["2027-01-01T00:00:00.000Z", 0, false],
])("checks the complete transaction budget", (now, uncertainty, allowed) => {
  expect(isFresh(now, uncertainty)).toBe(allowed);
});

it("rejects a non-derived approval id", async () => {
  const fixture = await artifactFixture({
    approvalId: "github-review:999",
    reviewDatabaseId: "123456789",
  });
  await expect(PolicyStore.load(fixture.paths)).resolves.toEqual({
    ok: false, reasonCode: "POLICY_INTEGRITY_FAILED",
  });
});
```

- [ ] **Step 3: Run and verify missing store failures**

Run: `pnpm --filter @okf-datahub/query-executor exec vitest run test/policy`

Expected: FAIL with missing policy modules.

- [ ] **Step 4: Implement bounded canonical artifact loading**

```ts
export interface ArtifactPaths {
  readonly policyIr: string;
  readonly resourceBinding: string;
  readonly reviewAttestation: string;
  readonly manifest: string;
}

export class PolicyStore {
  private constructor(
    private readonly handles: PrivateArtifactHandles,
    private readonly startupManifest: PolicyManifestV1,
  ) {}

  static async load(paths: ArtifactPaths): Promise<PolicyStoreLoadResult> {
    const handles = await openFourArtifactFilesNoFollow(paths);
    if (!handles.ok) return integrityFailure();
    const raw = await readFourOpenFiles(handles.value, 262_144);
    if (!raw.ok) {
      await closeFourOpenFiles(handles.value);
      return integrityFailure();
    }
    const parsed = parseAndRequireCanonicalBytes(raw.value);
    if (!parsed.ok || !verifyManifestTuple(parsed.value)) {
      await closeFourOpenFiles(handles.value);
      return integrityFailure();
    }
    return {
      ok: true,
      value: new PolicyStore(handles.value, parsed.value.manifest),
    };
  }

  async verifyIntegrityForRequest(): Promise<PolicyIntegrityResult> {
    const raw = await readFourOpenFiles(this.handles, 262_144);
    if (!raw.ok) return integrityFailure();
    const parsed = parseAndRequireCanonicalBytes(raw.value);
    if (
      !parsed.ok ||
      !verifyManifestTuple(parsed.value) ||
      !sameManifest(parsed.value.manifest, this.startupManifest)
    ) {
      return integrityFailure();
    }
    return integrityVerified(copyRequestPolicy(parsed.value));
  }
}
```

`openFourArtifactFilesNoFollow` uses `O_RDONLY | O_NOFOLLOW`, requires four
regular read-only files owned by the expected image UID/root, records device,
inode, mode, owner, and size, and keeps those descriptors private for the
process lifetime. `readFourOpenFiles` uses positional reads from offset zero,
rechecks `fstat` before and after each read, checks size before allocation, and
rejects metadata drift, trailing JSON, or non-canonical raw bytes. Every
request re-reads and rehashes the open inodes, compares the exact startup
manifest, and receives a fresh private copy only after validation. No method
exposes handles or mutable bytes. Shutdown closes all four descriptors.

- [ ] **Step 5: Implement exact freshness**

```ts
export interface ClockReading {
  readonly unixMilliseconds: number;
  readonly monotonicMilliseconds: number;
  readonly uncertaintyMilliseconds: number;
}

export interface TrustedClock {
  read(): ClockReading;
}

export class SystemTrustedClock implements TrustedClock {
  readonly #wallAtBoot = Date.now();
  readonly #monotonicAtBoot = Math.floor(performance.now());

  read(): ClockReading {
    const wall = Date.now();
    const monotonic = Math.floor(performance.now());
    const elapsed = monotonic - this.#monotonicAtBoot;
    const projected = this.#wallAtBoot + elapsed;
    if (
      !Number.isSafeInteger(wall) ||
      !Number.isSafeInteger(monotonic) ||
      !Number.isSafeInteger(elapsed) ||
      monotonic < 0 ||
      elapsed < 0 ||
      !Number.isSafeInteger(projected) ||
      !Number.isSafeInteger(wall + 1_000) ||
      wall + 1_000 < projected
    ) {
      return Object.freeze({
        unixMilliseconds: 0,
        monotonicMilliseconds: 0,
        uncertaintyMilliseconds: Number.MAX_SAFE_INTEGER,
      });
    }
    return Object.freeze({
      unixMilliseconds: Math.max(wall, projected),
      monotonicMilliseconds: monotonic,
      uncertaintyMilliseconds: 1_000,
    });
  }
}

export function verifyPolicyFreshness(
  policy: IntegrityVerifiedPolicy,
  clock: ClockReading,
): PolicyFreshnessResult {
  const expiry = Date.parse(policy.effectiveExpiresAt);
  const deadline = PolicyFreshnessDeadline.verifyAndCreate(expiry, clock);
  return deadline.ok
    ? freshnessVerified(policy, deadline.value)
    : deadline;
}

class PolicyFreshnessDeadline {
  private constructor(
    readonly effectiveExpiryUnixMilliseconds: number,
    readonly latestStartMonotonicMilliseconds: number,
  ) {}

  static verifyAndCreate(
    effectiveExpiryUnixMilliseconds: number,
    clock: ClockReading,
  ): StageResult<PolicyFreshnessDeadline, "POLICY_EXPIRED"> {
    const transactionBudgetMilliseconds = 5_000;
    const latestStartWallMilliseconds =
      effectiveExpiryUnixMilliseconds -
      clock.uncertaintyMilliseconds -
      transactionBudgetMilliseconds;
    const remainingMilliseconds =
      latestStartWallMilliseconds - clock.unixMilliseconds;
    const latestStartMonotonicMilliseconds =
      clock.monotonicMilliseconds + remainingMilliseconds;
    return Number.isSafeInteger(effectiveExpiryUnixMilliseconds) &&
      Number.isSafeInteger(latestStartWallMilliseconds) &&
      Number.isSafeInteger(remainingMilliseconds) &&
      remainingMilliseconds > 0 &&
      Number.isSafeInteger(latestStartMonotonicMilliseconds)
      ? {
          ok: true,
          value: new PolicyFreshnessDeadline(
            effectiveExpiryUnixMilliseconds,
            latestStartMonotonicMilliseconds,
          ),
        }
      : { ok: false, reasonCode: "POLICY_EXPIRED" };
  }
}
```

The 5,000 ms transaction budget is a local literal, not a parameter,
environment value, test override, or dependency field. A bypass test proves
extra positional values cannot be supplied through the public API and that a
policy expiring inside the fixed budget is denied.

`SystemTrustedClock` records a wall-clock/monotonic pair at boot, uses fixed 1,000 ms uncertainty, and denies if wall time moves backward more than 1,000 ms relative to the monotonic estimate.
The deadline class is module-private; `verifyAndCreate` is its sole constructor
owner and repeats every arithmetic guard before construction.
`PolicyFreshnessVerified`, `ResourceVerified`, `EvaluatedQueryPlan`, and
`PolicyAllowedPendingSchema` retain the private absolute monotonic deadline.
The opaque value also retains the validated effective-expiry Unix
milliseconds. Every later revalidation recomputes a fresh wall-derived
deadline from that retained expiry and takes the minimum with the original
monotonic deadline; it can shorten but never extend authority.

- [ ] **Step 6: Run policy, type, and lint gates**

Run:

```bash
pnpm --filter @okf-datahub/query-executor exec vitest run test/policy
pnpm --filter @okf-datahub/query-executor check
pnpm exec biome check apps/query-executor
```

Expected: PASS for all four mutations, canonical byte checks, manifest cross-links, and exact-date stale boundary.

- [ ] **Step 7: Review and commit**

Run the `code-review` skill, then:

```bash
git add apps/query-executor tsconfig.json pnpm-lock.yaml security/security-transitions.v1.json
git commit -m "feat(query-executor): verify pinned policy snapshots"
```

### Task 2: Fail-closed policy/context preflight state machine

**Branch:** `feat/executor-preflight-state-machine`

**Commit:** `feat(query-executor): enforce pre-database authorization states`

**Files:**
- Create: `apps/query-executor/src/state/executor-state.ts`
- Create: `apps/query-executor/src/state/preflight.ts`
- Create: `apps/query-executor/src/policy/evaluate-intent.ts`
- Create: `apps/query-executor/test/state/preflight.test.ts`
- Create: `apps/query-executor/test/state/preflight.property.test.ts`
- Modify: `security/security-transitions.v1.json`

**Interfaces:**
- Consumes: validated executor request, `PolicyStore`, and `TrustedClock`.
- Produces: `inspectContextPreflight` or `queryPreflight`; successful query preflight returns only `PolicyAllowedPendingSchema`.

- [ ] **Step 1: Write zero-database and email-denial tests**

```ts
it.each(["projection", "predicate"])("denies email %s before checkout", async (use) => {
  const db = countingDatabasePort();
  const result = await queryPreflight(emailRequest(use), dependencies(db));
  expect(result).toMatchObject({
    ok: false, reasonCode: "FIELD_USE_DENIED",
  });
  expect(db.checkoutCount).toBe(0);
  expect(db.applicationQueryCount).toBe(0);
});

it("inspection never reaches a database state", async () => {
  const trace = await inspectContextPreflight(validInspectRequest(), dependencies());
  expect(trace.states.some(isDatabaseState)).toBe(false);
});
```

- [ ] **Step 2: Run and verify the preflight is absent**

Run: `pnpm --filter @okf-datahub/query-executor exec vitest run test/state/preflight.test.ts test/state/preflight.property.test.ts`

Expected: FAIL with missing `preflight.js`.

- [ ] **Step 3: Define branded state constructors and transitions**

```ts
// LLM-CONTRACT:
// Accepts: POLICY_FRESHNESS_VERIFIED.
// Emits: RESOURCE_VERIFIED.
// Failure: DENIED.
// Invariant: request, DataHub evidence, Policy IR, and ResourceBinding
// identify the same fixed dataset.
function verifyResource(
  state: PolicyFreshnessVerified,
): ResourceVerificationResult {
  return exactIdentityMatch(state)
    ? resourceVerified(state)
    : denied("RESOURCE_NOT_BOUND");
}

export class PolicyAllowedPendingSchema {
  readonly #stateName = "POLICY_ALLOWED_PENDING_SCHEMA";
  private constructor(readonly plan: EvaluatedQueryPlan) {}
  get stateName(): "POLICY_ALLOWED_PENDING_SCHEMA" {
    return this.#stateName;
  }
  static fromResourceVerified(
    state: ResourceVerified,
  ): PolicyEvaluationResult {
    return explicitlyAllowsEveryUse(state)
      ? { ok: true, value: new PolicyAllowedPendingSchema(buildPlan(state)) }
      : denied(firstPolicyReason(state));
  }
}
```

No external schema contains a state name, and no parser can construct a branded state.

- [ ] **Step 4: Implement the exact transition order**

Inspection:

```text
ENVELOPE_RECEIVED → INPUT_REVALIDATED → DATAHUB_CONTEXT_REVALIDATED
→ POLICY_INTEGRITY_VERIFIED → POLICY_FRESHNESS_VERIFIED
→ RESOURCE_VERIFIED → POLICY_SUMMARY_VALIDATED → COMPLETED
```

Query preflight ends at:

```text
... → RESOURCE_VERIFIED → POLICY_ALLOWED_PENDING_SCHEMA
```

DataHub evidence may deny by mismatch; it can never add a field or permission absent from binding and Policy IR.
`POLICY_SUMMARY_VALIDATED` carries the attestation-derived `approvalId`
unchanged into `ContextSuccessV1`; a test compares its bytes with the loaded
attestation and rejects every noncanonical or mismatched representation.
The query state carries its `PolicyFreshnessDeadline` unchanged; a delayed
preflight result is not durable authorization.

- [ ] **Step 5: Run state and property gates**

Run:

```bash
pnpm --filter @okf-datahub/query-executor exec vitest run test/state
pnpm --filter @okf-datahub/query-executor check
pnpm exec biome check apps/query-executor/src/state apps/query-executor/src/policy
```

Expected: PASS; fast-check establishes
`PREFLIGHT_REJECTED ⇒ checkoutCount = 0`,
`PRE_APPLICATION_QUERY_REJECTED ⇒ applicationQueryCount = 0`, and the
prohibited sentinel never reaches pending authorization. A rejection after
checkout may have a transaction/catalog query but can never have an
application-table query.
Advance the monotonic clock beyond the retained deadline after preflight and
assert checkout may be released but `applicationQueryCount` remains zero.

- [ ] **Step 6: Review and commit**

Run the `code-review` skill, then:

```bash
git add apps/query-executor/src/state apps/query-executor/src/policy/evaluate-intent.ts apps/query-executor/test/state security/security-transitions.v1.json
git commit -m "feat(query-executor): enforce pre-database authorization states"
```

### Task 3: Bounded single-request UDS server

**Branch:** `feat/executor-uds-server`

**Commit:** `feat(query-executor): serve bounded executor frames`

**Files:**
- Create: `apps/query-executor/src/transport/frame-codec.ts`
- Create: `apps/query-executor/src/transport/execution-deadline.ts`
- Create: `apps/query-executor/src/transport/socket-path.ts`
- Create: `apps/query-executor/src/transport/dispatcher-port.ts`
- Create: `apps/query-executor/src/transport/uds-server.ts`
- Create: `apps/query-executor/test/transport/frame-codec.test.ts`
- Create: `apps/query-executor/test/transport/execution-deadline.test.ts`
- Create: `apps/query-executor/test/transport/uds-server.test.ts`
- Modify: `security/security-transitions.v1.json`

**Interfaces:**
- Consumes: one UDS connection and `ExecutorDispatcher`.
- Produces: `createExecutorUdsServer(config, dispatcher): Promise<ExecutorUdsServer>`.

`dispatcher-port.ts` owns the forward interface:

```ts
export interface ExecutorDispatcher {
  dispatch(
    request: ExecutorRequestV1,
    deadline: ExecutionDeadline,
    signal: AbortSignal,
  ): Promise<ExecutorResponseV1>;
}
```

Task 3 tests use a fake implementation; Task 9's concrete dispatcher implements
this unchanged port. Transport never imports the later concrete module. On
connection admission the UDS server creates one absolute monotonic
`ExecutionDeadline` at `acceptedAt + 6_500 ms`; frame read, dispatch, response
validation/write, cursor read/close, and rollback receive this same value.
`execution-deadline.ts` owns the module-private constructor.
`ExecutionDeadline.fromAdmission` accepts only a finite non-negative safe
integer, rejects overflow/non-increasing addition, and is callable only at the
registered `admitConnection` transition in `uds-server.ts`. Failure occurs
before envelope parsing and writes zero response bytes. Deadline mutation,
deserialization, subclassing, `as` assertions, and a second factory call are
TCB-test failures.

```ts
static fromAdmission(
  acceptedAtMonotonicMilliseconds: number,
): StageResult<ExecutionDeadline, "INTERNAL_FAILURE"> {
  const expiresAt = acceptedAtMonotonicMilliseconds + 6_500;
  return Number.isSafeInteger(acceptedAtMonotonicMilliseconds) &&
    acceptedAtMonotonicMilliseconds >= 0 &&
    Number.isSafeInteger(expiresAt) &&
    expiresAt > acceptedAtMonotonicMilliseconds
    ? { ok: true, value: new ExecutionDeadline(expiresAt) }
    : { ok: false, reasonCode: "INTERNAL_FAILURE" };
}
```

- [ ] **Step 1: Write allocation, ownership, and one-frame tests**

```ts
it("rejects an oversized declared length before body allocation", async () => {
  const allocator = countingAllocator();
  await expect(decodeFrame(headerFor(32_765), allocator)).rejects.toThrow();
  expect(allocator.allocatedBytes).toBe(0);
});

it.each(["regular-file", "wrong-owner-socket", "wrong-group-socket"])(
  "refuses existing %s path",
  async (kind) => expect(bindFixture(kind)).rejects.toThrow(),
);
```

- [ ] **Step 2: Run and verify missing server failures**

Run: `pnpm --filter @okf-datahub/query-executor exec vitest run test/transport`

Expected: FAIL with missing transport modules.

- [ ] **Step 3: Implement exact framing**

```ts
export async function readSingleRequestFrame(
  socket: Readable,
  deadline: ExecutionDeadline,
  signal: AbortSignal,
): Promise<ExecutorRequestV1> {
  const header = await readExactly(socket, 4, deadline, signal);
  const length = header.readUInt32BE(0);
  if (length > 32_764) throw new FrameError();
  const bytes = await readExactly(socket, length, deadline, signal);
  await requireNoTrailingByte(socket, deadline, signal);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const value: unknown = JSON.parse(text);
  return requireExecutorRequest(value);
}
```

The encoder validates the application response before serialization and rejects
a response body above 327,676 bytes, so the full header-inclusive frame cannot
exceed 327,680 bytes. Boundary tests accept body lengths 32,764/327,676 and
reject 32,765/327,677 before excess allocation.

`FrameError` is a transport-private fixed-message class with no input-derived
constructor fields. Before a complete validated request and operation ID exist,
invalid UTF-8, length, JSON, or closed-schema failures destroy the connection
with zero response bytes. Context maps EOF/protocol failure to its own fixed
`INTERNAL_FAILURE` envelope using the already-created public operation ID. Only
failures after a validated executor envelope may emit a closed executor
rejection repeating that exact ID. Tests assert zero writes for every
pre-envelope failure.

- [ ] **Step 4: Implement secure socket lifecycle**

The directory mode is `0710`, socket mode `0660`, owner is fixed executor UID,
group is the dedicated bridge GID, active dispatcher count is 1, queue length
is 4, and the absolute connection deadline is 6,500 ms after admission. No
layer converts it back into a fresh duration. Startup may unlink only a socket
at the exact fixed path with expected owner/group; every other existing object
prevents readiness.

- [ ] **Step 5: Run transport and cancellation tests**

Run:

```bash
pnpm --filter @okf-datahub/query-executor exec vitest run test/transport
pnpm --filter @okf-datahub/query-executor check
```

Expected: PASS for invalid UTF-8, truncation, trailing bytes, second frame, disconnect, timeout, operation-ID mismatch, and queue overflow.

- [ ] **Step 6: Review and commit**

Run the `code-review` skill, then:

```bash
git add apps/query-executor/src/transport apps/query-executor/test/transport security/security-transitions.v1.json
git commit -m "feat(query-executor): serve bounded executor frames"
```

### Task 4: Synthetic table and column-only executor role

**Delivery:** This section is an umbrella only. Deliver these sequential,
non-stacked PR tasks; merge each into `main` before starting the next.

| Task | Branch | Files (exhaustive) | Commit |
|---|---|---|---|
| 4A — relation and disposable harness | `feat/postgres-synthetic-harness` | Create `infra/postgres/init/010-customer-orders.sql`, `infra/postgres/compose.test.yaml`, `apps/query-executor/test/postgres/harness.ts`, `apps/query-executor/test/postgres/run-integration-suite.mjs`, `apps/query-executor/test/postgres/synthetic-table.integration.test.ts`; modify `security/security-sql-transitions.v1.json` | `feat(postgres): add pinned synthetic relation harness` |
| 4B — secret-provisioned column role | `feat/postgres-executor-role` | Create `infra/postgres/init/020-executor-role.sh`, `infra/postgres/sql/executor-role.sql`, `apps/query-executor/test/postgres/role.integration.test.ts`; modify `infra/postgres/compose.test.yaml`, `security/security-shell-transitions.v1.json`, `security/security-sql-transitions.v1.json` | `feat(postgres): provision column-only executor role` |
| 4C — monitoring and lock boundary | `test/postgres-executor-boundaries` | Create `infra/postgres/sql/monitoring.sql`, `apps/query-executor/test/postgres/monitoring-lock.integration.test.ts`; modify `infra/postgres/compose.test.yaml`, `security/security-sql-transitions.v1.json` | `test(postgres): verify monitoring and lock boundaries` |

Each slice runs its focused test through the fresh-Compose runner plus
TypeScript/Biome and `code-review`. If a slice exceeds 220 authored lines after
excluding `LLM-CONTRACT` comments, split it again before review.

**Files:**
- Create: `infra/postgres/init/010-customer-orders.sql`
- Create: `infra/postgres/init/020-executor-role.sh`
- Create: `infra/postgres/sql/executor-role.sql`
- Create: `infra/postgres/sql/monitoring.sql`
- Create: `infra/postgres/compose.test.yaml`
- Create: `apps/query-executor/test/postgres/harness.ts`
- Create: `apps/query-executor/test/postgres/run-integration-suite.mjs`
- Create: `apps/query-executor/test/postgres/synthetic-table.integration.test.ts`
- Create: `apps/query-executor/test/postgres/role.integration.test.ts`
- Create: `apps/query-executor/test/postgres/monitoring-lock.integration.test.ts`
- Modify: `security/security-shell-transitions.v1.json`
- Modify: `security/security-sql-transitions.v1.json`

**Interfaces:**
- Consumes: disposable PostgreSQL 18.4, an admin-only monitoring extension, and
  a secret-provided SCRAM password.
- Produces: `analytics.customer_orders` and login role `okf_query_executor` with only four column-level `SELECT` grants.

- [ ] **Step 1: Create the exact synthetic table**

```sql
-- LLM-CONTRACT:
-- Accepts: a fresh PostgreSQL 18.4 demo database with no analytics schema.
-- Emits: the exact synthetic owner, schema, relation, constraints, and rows.
-- Failure: single init transaction aborts without partial demo objects.
-- Invariant: all identifiers, types, constraints, and values are fixed literals.
BEGIN;
CREATE ROLE demo_owner
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA analytics AUTHORIZATION demo_owner;
CREATE TABLE analytics.customer_orders (
  customer_id text NOT NULL,
  email text NOT NULL,
  total numeric(12,2) NOT NULL,
  status text NOT NULL,
  placed_on date NOT NULL,
  CONSTRAINT customer_orders_customer_id_octets_ck
    CHECK (octet_length(customer_id) <= 64),
  CONSTRAINT customer_orders_customer_id_format_ck
    CHECK (customer_id ~ '^cust_[0-9]{3,12}$'),
  CONSTRAINT customer_orders_customer_id_unique
    UNIQUE (customer_id),
  CONSTRAINT customer_orders_status_ck
    CHECK (status IN ('PENDING', 'PAID', 'CANCELLED')),
  CONSTRAINT customer_orders_total_nonnegative_ck
    CHECK (total >= 0)
);
ALTER TABLE analytics.customer_orders OWNER TO demo_owner;
INSERT INTO analytics.customer_orders VALUES
  ('cust_001', 'alice@example.invalid', 125.00, 'PAID', DATE '2026-07-01'),
  ('cust_002', 'bob@example.invalid', 20.00, 'PENDING', DATE '2026-07-02');
COMMIT;
```

- [ ] **Step 2: Write privilege failures before role SQL**

Test safe explicit-column `SELECT` succeeds while `email`, `*`,
`COPY analytics.customer_orders TO STDOUT`, DML, DDL, temp creation,
`SET ROLE`, explicit `LOCK TABLE`, and application-schema routine execution
fail.

- [ ] **Step 3: Run and verify the role is missing**

Run:

```bash
docker compose -f infra/postgres/compose.test.yaml up -d --wait postgres
pnpm --filter @okf-datahub/query-executor exec vitest run test/postgres/role.integration.test.ts
```

Expected: FAIL because `okf_query_executor` is absent.
Immediately run
`docker compose -f infra/postgres/compose.test.yaml down -v`; retaining the
initialized red-test volume is forbidden because entrypoint init scripts run
only once.

`compose.test.yaml` starts the exact PostgreSQL 18.4 image with:

```yaml
environment:
  POSTGRES_INITDB_ARGS: "--encoding=UTF8 --locale=C"
command:
  - postgres
  - -c
  - shared_preload_libraries=pg_stat_statements
  - -c
  - compute_query_id=on
  - -c
  - pg_stat_statements.track=all
```

Readiness requires `server_encoding=UTF8`, `lc_collate=C`, and `lc_ctype=C`;
the schema projection also binds every column's collation, default,
generated/identity status, and the complete role/ACL contract. Host locale
inheritance is forbidden.

The admin init creates schema `okf_monitor`, installs the PostgreSQL 18.4
bundled `pg_stat_statements` extension at exact version `1.12` in that schema,
and requires the complete extension set to be exactly `plpgsql@1.0` plus
`pg_stat_statements@1.12`. It revokes `USAGE` on `okf_monitor` and all
table/function privileges there from `PUBLIC` and
`okf_query_executor`. Only the test admin harness may reset/read the statistics;
the executor cannot resolve, select, or execute any extension object.
`monitoring.sql` begins with its four registered `-- LLM-CONTRACT` clauses,
wraps the complete extension/schema/revoke sequence in explicit
`BEGIN`/`COMMIT`, and has a mid-file failure test proving no partial extension
or ACL state remains.

- [ ] **Step 4: Add the exact role and ACLs**

`020-executor-role.sh` is the only init entrypoint for the role SQL:

```sh
#!/bin/sh
# LLM-CONTRACT:
# Accepts: one PostgreSQL-process-owned mode-0400 fixed-length executor password file.
# Emits: one psql process with a single environment-backed password variable.
# Failure: non-zero exit before any role or ACL mutation.
# Invariant: the password never appears in argv, stdout, SQL files, or logs.
set -eu
secret=/run/executor-secret/executor_db_password
test -f "$secret"
test "$(stat -c '%a' "$secret")" = "400"
test "$(stat -c '%u:%g' "$secret")" = "$(id -u):$(id -g)"
test "$(stat -c '%s' "$secret")" = "43"
LC_ALL=C grep -Eq '^[A-Za-z0-9_-]{43}$' "$secret"
executor_password=
IFS= read -r executor_password < "$secret" || :
test "${#executor_password}" -eq 43
export EXECUTOR_DB_PASSWORD="$executor_password"
unset executor_password
exec psql \
  --set=ON_ERROR_STOP=1 \
  --single-transaction \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --file /opt/okf-postgres/executor-role.sql
```

The test Compose uses a completed one-shot, networkless secret provisioner to
copy the host fixture into a tmpfs volume as the PostgreSQL UID/GID with mode
`0400`; PostgreSQL mounts only that tmpfs path. A missing/extra byte, newline,
wrong owner, wrong mode, or failed provisioner prevents database readiness.

`infra/postgres/sql/executor-role.sql` contains:

```sql
-- LLM-CONTRACT:
-- Accepts: admin session plus one validated EXECUTOR_DB_PASSWORD environment value.
-- Emits: exact executor role, settings, and least-privilege ACL state.
-- Failure: ON_ERROR_STOP aborts without accepting a partial migration.
-- Invariant: only the fixed password slot is dynamic; identifiers and grants are literals.
\getenv executor_password EXECUTOR_DB_PASSWORD
REVOKE ALL ON DATABASE demo FROM PUBLIC;
REVOKE TEMPORARY ON DATABASE demo FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA analytics FROM PUBLIC;
CREATE ROLE okf_query_executor
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1
  PASSWORD :'executor_password';
\unset executor_password
GRANT CONNECT ON DATABASE demo TO okf_query_executor;
GRANT USAGE ON SCHEMA analytics TO okf_query_executor;
REVOKE ALL ON analytics.customer_orders FROM PUBLIC, okf_query_executor;
GRANT SELECT (customer_id, total, status, placed_on)
  ON analytics.customer_orders TO okf_query_executor;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA analytics
  FROM PUBLIC, okf_query_executor;
ALTER ROLE okf_query_executor SET default_transaction_read_only = on;
ALTER ROLE okf_query_executor SET statement_timeout = '3000ms';
ALTER ROLE okf_query_executor SET lock_timeout = '250ms';
ALTER ROLE okf_query_executor SET transaction_timeout = '5000ms';
ALTER ROLE okf_query_executor
  SET idle_in_transaction_session_timeout = '2000ms';
ALTER ROLE okf_query_executor SET search_path = pg_catalog;
ALTER ROLE okf_query_executor SET row_security = on;
ALTER DEFAULT PRIVILEGES FOR ROLE demo_owner IN SCHEMA analytics
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE demo_owner IN SCHEMA analytics
  REVOKE ALL ON FUNCTIONS FROM PUBLIC;
```

psql's quoted variable syntax prevents SQL parsing of the value, and the value
is absent from process arguments and logs. The SQL gate permits exactly the
shown initial `\getenv` and one matching `\unset` for
`executor_password`; every other psql meta-command, variable, backtick, shell
escape, or dynamic SQL is rejected. The shell gate permits exactly the
fixed-file `read` primitive after owner/mode/size/grammar checks. Tests prove
the secret is absent from argv, process output, audit, database logs, and
committed files. A fault-injection test forces a statement failure after role
creation and proves `--single-transaction` leaves no role, grant, revoke, or
default-privilege drift. The integration test queries
`pg_auth_members` recursively and requires no direct or indirect membership for
`okf_query_executor`.

- [ ] **Step 5: Verify lock priming under column ACL**

Open a transaction as the executor, issue:

```sql
SELECT "customer_id"
FROM ONLY "analytics"."customer_orders"
WHERE false;
```

From the admin test connection, assert an `AccessShareLock` is granted and remains until rollback. Assert explicit `LOCK TABLE` still fails.

- [ ] **Step 6: Run, clean up, review, and merge each mandatory slice**

Run:

```bash
node apps/query-executor/test/postgres/run-integration-suite.mjs \
  --test test/postgres/synthetic-table.integration.test.ts
node apps/query-executor/test/postgres/run-integration-suite.mjs \
  --test test/postgres/role.integration.test.ts
node apps/query-executor/test/postgres/run-integration-suite.mjs \
  --test test/postgres/monitoring-lock.integration.test.ts
```

The runner provisions fresh secrets, starts a fresh pinned Compose volume,
waits for health, invokes Vitest without a shell, and always runs `down -v` in
`finally`. During implementation, run only the focused test available in the
current slice, then type/Biome checks and `code-review`; commit only that row's
exclusive files with its named commit, merge, update `main`, and continue. No
initialized volume survives between slices.
Every SQL file begins with its registered four `-- LLM-CONTRACT` clauses.
`020-executor-role.sh` begins with its registered four
`# LLM-CONTRACT` clauses and is the only shell wrapper; both gates run before
PostgreSQL starts.

### Task 5: Database principal and schema attestation

**Branch:** `feat/executor-database-attestation`

**Commit:** `feat(query-executor): attest database role and live schema`

**Files:**
- Create: `apps/query-executor/src/db/config.ts`
- Create: `apps/query-executor/src/db/type-parsers.ts`
- Create: `apps/query-executor/src/db/pool.ts`
- Create: `apps/query-executor/src/db/role-attestation.ts`
- Create: `apps/query-executor/src/db/schema-projection.ts`
- Create: `apps/query-executor/src/db/schema-attestation.ts`
- Create: `apps/query-executor/test/db/role-attestation.test.ts`
- Create: `apps/query-executor/test/db/schema-attestation.test.ts`
- Modify: `security/security-transitions.v1.json`

**Interfaces:**
- Consumes: fixed secret DSN, `ResourceBindingV1`, and the contracts-owned
  `RuntimeSchemaProjectionV1` parser and digest domain.
- Produces: `createExecutorPool`, `attestExecutorRole`, `attestBootSchema`, and `collectRuntimeSchema`; boot success returns a branded `BootSchemaAttestation`.

```ts
type CollectedRuntimeSchema = Readonly<{
  projection: RuntimeSchemaProjectionV1;
  digest: Sha256Digest;
}>;
```

`collectRuntimeSchema` first parses an exact
`postgres-runtime-schema/v1` projection, canonicalizes that validated
projection, and computes its domain-separated digest. The digest is adjacent
private evidence, never a field inside the strict projection and never part of
its own hash input. Both boot and request-time collection return this closed
pair.

- [ ] **Step 1: Write role/schema drift tests**

Cases: wrong database/server major/user, superuser, inherited membership,
table-level `SELECT`, email grant, missing safe grant, owner role,
view/partition/foreign table, partition parent, inheritance parent/child, RLS,
subclass, trigger, rule, generated column, domain/custom type, custom
collation, changed type/typmod/nullability/check, executor or `PUBLIC`
database/schema/relation/routine/monitoring grant drift, unexpected extension,
cast/operator outside `pg_catalog`, static/runtime digest-domain substitution,
and reordered/duplicate/missing/additional resolved OIDs.

- [ ] **Step 2: Run and verify missing attestors**

Run: `pnpm --filter @okf-datahub/query-executor exec vitest run test/db`

Expected: FAIL with missing attestation modules.

- [ ] **Step 3: Implement a fixed one-connection pool**

```ts
export function createExecutorPool(config: FixedDatabaseConfig): Pool {
  return new Pool({
    connectionString: config.dsnFromSecretFile,
    max: 1,
    connectionTimeoutMillis: 1_000,
    application_name: "okf-query-executor",
    types: createExecutorTypeParsers(),
  });
}
```

`createExecutorTypeParsers` is implemented and tested in this task; it returns
strings for every permitted PostgreSQL OID and rejects unregistered or binary
decoding. No request, DataHub value, artifact, or environment-provided database
identifier may alter the fixed DSN/database/schema/relation.

- [ ] **Step 4: Implement exact catalog projections**

`attestExecutorRole` verifies database `demo`, PostgreSQL major 18, `session_user = current_user = okf_query_executor`, login, no superuser/owner/bypass-RLS/inherit/membership, connection limit 1, no table-level grant, exactly four column grants, and no email grant.

`attestBootSchema` verifies one permanent ordinary heap table with fixed owner
and relation OID, no partition/inheritance/RLS/rules/user
triggers/generated columns, exact five ordinals/types/typmods/not-null/checks,
built-in casts/operators/functions, and the static schema contract digest. It
also requires the exact extension set `plpgsql@1.0` and
`pg_stat_statements@1.12`, with the latter in `okf_monitor` and inaccessible to
the executor or `PUBLIC`; every other extension/version/schema/ACL is drift.
It builds and validates one closed `postgres-runtime-schema/v1` projection,
computes only the matching runtime domain digest, and stores the exact
`CollectedRuntimeSchema` pair privately in `BootSchemaAttestation`. The reviewed
`postgres-schema/v1` digest remains a separate field and cannot satisfy this
comparison.

- [ ] **Step 5: Run attestation and digest tests**

Run:

```bash
pnpm --filter @okf-datahub/query-executor exec vitest run test/db
pnpm --filter @okf-datahub/query-executor check
pnpm exec biome check apps/query-executor/src/db
```

Expected: PASS; every single drift case prevents readiness or produces
`DB_SCHEMA_MISMATCH`. Mutating the projection after validation, inserting a
`digest` property into it, changing the digest domain, or pairing it with a
digest from another projection is rejected.

- [ ] **Step 6: Review and commit**

Run the `code-review` skill, then:

```bash
git add apps/query-executor/src/db apps/query-executor/test/db security/security-transitions.v1.json
git commit -m "feat(query-executor): attest database role and live schema"
```

### Task 6: Lock-first read-only transaction

**Branch:** `feat/executor-lock-first-transaction`

**Commit:** `feat(query-executor): enforce lock-first read-only transactions`

**Files:**
- Create: `apps/query-executor/src/db/transaction-state.ts`
- Create: `apps/query-executor/src/db/transaction.ts`
- Create: `apps/query-executor/src/db/client-lifecycle.ts`
- Create: `apps/query-executor/test/db/transaction.test.ts`
- Create: `apps/query-executor/test/postgres/lock-prime.integration.test.ts`
- Modify: `security/security-transitions.v1.json`

**Interfaces:**
- Consumes: pool, `BootSchemaAttestation`, `PolicyAllowedPendingSchema`,
  `TrustedClock`, the request's one non-resetting execution deadline, and
  `AbortSignal`.
- Produces: `openGovernedTransaction`; success after live digest comparison yields branded `SchemaVerifiedAuthorization`.

- [ ] **Step 1: Write exact-order and failure tests**

Assert the retained policy deadline is revalidated after checkout and
immediately before the first statement. Every statement then uses the same
client and this sequence:

```text
BEGIN → six SET LOCAL commands → lock primer → runtime schema projection
```

Assert an expired retained deadline releases the checked-out client with
`POLICY_EXPIRED`, `NO_TRANSACTION`, and zero SQL. Also assert no
catalog/application `SELECT` precedes the lock primer, lock timeout maps to
`RESOURCE_BUSY`, schema mismatch runs zero application queries, and
cancellation destroys the client.
Run the same zero-SQL assertion when the monotonic value remains below its
original deadline but wall time jumps forward far enough that the retained
effective-expiry timestamp no longer covers uncertainty plus 5,000 ms.

- [ ] **Step 2: Run the unit test and verify transaction code is absent**

Run: `pnpm --filter @okf-datahub/query-executor exec vitest run test/db/transaction.test.ts`

Expected: FAIL with missing `transaction.js`.

- [ ] **Step 3: Implement the fixed transaction preamble**

```ts
const PREAMBLE: readonly [
  string, string, string, string, string, string, string,
] = Object.freeze([
  "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
  "SET LOCAL statement_timeout = '3000ms'",
  "SET LOCAL lock_timeout = '250ms'",
  "SET LOCAL transaction_timeout = '5000ms'",
  "SET LOCAL idle_in_transaction_session_timeout = '2000ms'",
  "SET LOCAL search_path = pg_catalog",
  "SET LOCAL row_security = on",
]);

const LOCK_PRIMER = `
SELECT "customer_id"
FROM ONLY "analytics"."customer_orders"
WHERE false
`;
```

`revalidatePolicyFreshnessForBegin` compares both the retained monotonic
deadline and a fresh wall-derived deadline, takes the earlier value, and can
only call module-private `BeginFreshnessLease.revalidateAndCreate`.
That factory uses the retained effective-expiry Unix milliseconds, fresh
`ClockReading`, shared `ExecutionDeadline`, and signal; it is the sole
constructor owner and returns a single-use lease. `BEGIN` consumes that lease in
the same transition. No `await`, callback, queue admission, or pool checkout is
permitted between the final clock read and issuing `BEGIN`; if the signal is
already aborted or the shared execution deadline is exhausted, the client is
destroyed without a statement.

- [ ] **Step 4: Create authorization only after live schema verification**

```ts
// LLM-CONTRACT:
// Accepts: DB_RELATION_LOCKED.
// Emits: DB_SCHEMA_VERIFIED only when the lock-held live projection equals boot.
// Failure: DENIED with zero application-query transitions.
// Invariant: schema verification retains the same transaction and relation lock.
async function verifyLockedSchema(
  locked: DbRelationLocked,
): Promise<StageResult<DbSchemaVerified, SchemaAuthorizationFailureCode>> {
  const runtime = await collectRuntimeSchema(locked.client, locked.boot);
  return runtime.ok &&
    runtime.value.projection.apiVersion === "postgres-runtime-schema/v1" &&
    runtime.value.digest === locked.boot.runtimeDigest
    ? DbSchemaVerified.afterExactMatch(
        locked, runtime.value.projection, runtime.value.digest,
      )
    : denied("DB_SCHEMA_MISMATCH");
}

// LLM-CONTRACT:
// Accepts: DB_SCHEMA_VERIFIED plus POLICY_ALLOWED_PENDING_SCHEMA.
// Emits: AUTHORIZED only when operation, binding, and schema digests are equal.
// Failure: DENIED with zero application-query transitions.
// Invariant: authorization cannot be constructed from DB_RELATION_LOCKED.
function authorizeVerifiedSchema(
  verified: DbSchemaVerified,
  pending: PolicyAllowedPendingSchema,
): StageResult<SchemaVerifiedAuthorization, SchemaAuthorizationFailureCode> {
  return samePendingExecution(verified, pending)
    ? SchemaVerifiedAuthorization.fromVerifiedSchema(verified, pending)
    : denied("DB_SCHEMA_MISMATCH");
}
```

`SchemaVerifiedAuthorization` retains the non-extendable policy deadline. It is
not yet sufficient to issue application SQL: Task 8 must consume a second
freshness lease at the application-query boundary. Expiry after `BEGIN` becomes
`RollbackPendingFailure<"POLICY_EXPIRED">`.

- [ ] **Step 5: Run transaction gates**

Run:

```bash
pnpm --filter @okf-datahub/query-executor exec vitest run test/db/transaction.test.ts
node apps/query-executor/test/postgres/run-integration-suite.mjs \
  --test test/postgres/lock-prime.integration.test.ts
pnpm --filter @okf-datahub/query-executor check
```

Expected: PASS; explicit `LOCK TABLE` does not exist in application source.
Scheduler delay or a forward wall jump before `BEGIN` returns
`POLICY_EXPIRED` with zero SQL; delay after `BEGIN` is left as an unconsumed
authorization for Task 8 to reject before the application query.

- [ ] **Step 6: Review and commit**

Run the `code-review` skill, then:

```bash
git add apps/query-executor/src/db apps/query-executor/test/db apps/query-executor/test/postgres/lock-prime.integration.test.ts security/security-transitions.v1.json
git commit -m "feat(query-executor): enforce lock-first read-only transactions"
```

### Task 7: Closed typed SQL compiler

**Branch:** `feat/executor-typed-sql`

**Commit:** `feat(query-executor): compile only authorized SQL`

**Files:**
- Create: `apps/query-executor/src/sql/compiler-map.ts`
- Create: `apps/query-executor/src/sql/compiler.ts`
- Create: `apps/query-executor/test/sql/compiler.test.ts`
- Create: `apps/query-executor/test/sql/compiler.property.test.ts`
- Modify: `security/security-transitions.v1.json`

**Interfaces:**
- Consumes: only `SchemaVerifiedAuthorization`.
- Produces:
  `compileAuthorizedQuery(authorization):
  StageResult<CompiledSelect, CompilationFailureCode>`.

- [ ] **Step 1: Write exact SQL and grammar properties**

```ts
expect(compileAuthorizedQuery(totalAtLeast100())).toEqual({
  text:
    'SELECT "customer_id", "total"\n' +
    'FROM ONLY "analytics"."customer_orders"\n' +
    'WHERE "total" OPERATOR(pg_catalog.>=) $1::pg_catalog.numeric\n' +
    'ORDER BY "customer_id" ASC\n' +
    'LIMIT $2::pg_catalog.int8',
  values: ["100.00", 51],
  resultColumns: [
    { fieldId: "customer_id", type: "OPAQUE_ID" },
    { fieldId: "total", type: "DECIMAL" },
  ],
  requestedLimit: 50,
});
```

Property tests assert identifier subset, SQL parameter-marker/value count
equality, operator/type equality, and absence of input strings, semicolon,
comments, star, functions, joins, aliases, grouping, CTEs, subqueries,
set operations, and locking clauses. The sole sorting exception is the exact
code-owned `ORDER BY "customer_id" ASC`; caller-controlled sort fields,
directions, omission, or an additional ordering term are forbidden. The
reviewed unique constraint on `customer_id` makes limit/truncation selection
deterministic.

- [ ] **Step 2: Run and verify missing compiler failures**

Run: `pnpm --filter @okf-datahub/query-executor exec vitest run test/sql`

Expected: FAIL with missing compiler.

- [ ] **Step 3: Implement the closed map**

```ts
type CompilerFieldById = Readonly<{
  customer_id: Readonly<{
    identifier: '"customer_id"';
    cast: "pg_catalog.text";
    type: "OPAQUE_ID";
  }>;
  total: Readonly<{
    identifier: '"total"';
    cast: "pg_catalog.numeric";
    type: "DECIMAL";
  }>;
  status: Readonly<{
    identifier: '"status"';
    cast: "pg_catalog.text";
    type: "ENUM";
  }>;
  placed_on: Readonly<{
    identifier: '"placed_on"';
    cast: "pg_catalog.date";
    type: "DATE";
  }>;
}>;

type SafeFieldId = keyof CompilerFieldById;

const COMPILER_FIELDS: CompilerFieldById = Object.freeze({
  customer_id: Object.freeze({
    identifier: '"customer_id"', cast: "pg_catalog.text", type: "OPAQUE_ID",
  }),
  total: Object.freeze({
    identifier: '"total"', cast: "pg_catalog.numeric", type: "DECIMAL",
  }),
  status: Object.freeze({
    identifier: '"status"', cast: "pg_catalog.text", type: "ENUM",
  }),
  placed_on: Object.freeze({
    identifier: '"placed_on"', cast: "pg_catalog.date", type: "DATE",
  }),
});
```

There is no `email` member and no default map lookup. Operators are a closed value-type/operator table and emit `OPERATOR(pg_catalog.<op>)`; values are only strings or the numeric server limit.
Every field entry and every nested operator-table entry is explicitly
`Object.freeze`d; freezing only the outer record is insufficient. Mutation
tests require `Object.isFrozen` at every level and prove neither keys nor
identifier/cast/type/operator values can change.

- [ ] **Step 4: Run compiler and property tests**

Run:

```bash
pnpm --filter @okf-datahub/query-executor exec vitest run test/sql
pnpm --filter @okf-datahub/query-executor check
pnpm exec biome check apps/query-executor/src/sql
```

Expected: PASS for all allowed predicate combinations; `PROHIBITED` is unrepresentable in compiler inputs.

- [ ] **Step 5: Review and commit**

Run the `code-review` skill, then:

```bash
git add apps/query-executor/src/sql apps/query-executor/test/sql security/security-transitions.v1.json
git commit -m "feat(query-executor): compile only authorized SQL"
```

### Task 8: Typed bounded results and rollback-before-release

**Delivery:** This section is an umbrella only. Deliver these sequential,
non-stacked PR tasks; merge each into `main` before starting the next.

| Task | Branch | Files (exhaustive) | Commit |
|---|---|---|---|
| 8A — output validation and sealed buffer | `feat/executor-output-validation` | Create `apps/query-executor/src/output/validator.ts`, `apps/query-executor/src/output/result-buffer.ts`, `apps/query-executor/test/output/result.test.ts`; modify `security/security-transitions.v1.json` | `feat(query-executor): validate and seal bounded rows` |
| 8B — bounded cursor | `feat/executor-cursor-execution` | Create `apps/query-executor/src/db/execute-select.ts`, `apps/query-executor/test/db/execute-select.test.ts`; modify `security/security-transitions.v1.json` | `feat(query-executor): execute one bounded cursor` |
| 8C — rollback disposition | `feat/executor-rollback-lifecycle` | Create `apps/query-executor/src/db/rollback.ts`, `apps/query-executor/test/db/rollback.test.ts`; modify `security/security-transitions.v1.json` | `feat(query-executor): confirm rollback disposition` |
| 8D — governed orchestration | `feat/executor-governed-query` | Create `apps/query-executor/src/execution/governed-query.ts`, `apps/query-executor/test/execution/governed-query.test.ts`, `apps/query-executor/test/postgres/rollback.integration.test.ts`; modify `security/security-transitions.v1.json` | `feat(query-executor): release rows only after rollback` |

Each slice runs focused unit tests, TypeScript, Biome, and `code-review`; 8D
also uses the fresh-Compose runner. If a slice exceeds 220 authored lines after
excluding `LLM-CONTRACT` comments, split it again before review.

**Files:**
- Create: `apps/query-executor/src/db/execute-select.ts`
- Create: `apps/query-executor/src/db/rollback.ts`
- Create: `apps/query-executor/src/output/validator.ts`
- Create: `apps/query-executor/src/output/result-buffer.ts`
- Create: `apps/query-executor/src/execution/governed-query.ts`
- Create: `apps/query-executor/test/db/execute-select.test.ts`
- Create: `apps/query-executor/test/db/rollback.test.ts`
- Create: `apps/query-executor/test/output/result.test.ts`
- Create: `apps/query-executor/test/execution/governed-query.test.ts`
- Create: `apps/query-executor/test/postgres/rollback.integration.test.ts`
- Modify: `security/security-transitions.v1.json`

**Interfaces:**
- Consumes: lock-held transaction, `CompiledSelect`, `TrustedClock`, the same
  request-owned `ExecutionDeadline`, and `AbortSignal`.
- Produces: `executeGovernedQuery`; a successful `QueryExecutionOutcome` becomes constructible only after rollback success.

- [ ] **Step 1: Write invalid-cell and release-order tests**

Reject object, `Buffer`, `Date`, NaN, infinity, wrong row width, invalid opaque ID, noncanonical decimal, unknown enum, invalid date, and any result JSON over 262,144 bytes. Verify one bad cell releases zero rows.

```ts
it("cannot expose buffered rows before rollback resolves", async () => {
  const rollback = deferred<void>();
  const execution = executeGovernedQuery(validAuthorization(), deps({ rollback }));
  await deps.waitForBufferedRows();
  expect(await settlesWithin(execution, 20)).toBe(false);
  rollback.resolve();
  expect((await execution).status).toBe("COMPLETED");
});

it.each(["before-query", "cursor-close", "rollback"])(
  "destroys the client and releases no rows when cancelled during %s",
  async (phase) => {
    const deps = pausableExecutionAt(phase);
    const result = executeGovernedQuery(validAuthorization(), deps);
    await deps.reachedPhase;
    deps.abort();
    expect(await result).toMatchObject({
      status: "REJECTED",
      reasonCodes: ["INTERNAL_FAILURE"],
      cleanup: "CLIENT_DESTROYED",
    });
    expect(deps.publicRows).toHaveLength(0);
  },
);

it.each(["monotonic-expiry", "forward-wall-jump"])(
  "rolls back without an application query after %s",
  async (clockChange) => {
    const deps = delayedAfterSchemaVerification(clockChange);
    const result = await executeGovernedQuery(validAuthorization(), deps);
    if (result.status !== "REJECTED") {
      throw new Error("expected fixed rejection");
    }
    expect(result.reasonCodes).toEqual(["POLICY_EXPIRED"]);
    expect(result.cleanup).toBe("ROLLED_BACK");
    expect(deps.applicationQueryCount).toBe(0);
  },
);
```

- [ ] **Step 2: Run and verify missing result/orchestration failures**

Run only the current row's not-yet-implemented test:

```bash
# 8A
pnpm --filter @okf-datahub/query-executor exec vitest run test/output/result.test.ts
# 8B, after 8A merges
pnpm --filter @okf-datahub/query-executor exec vitest run test/db/execute-select.test.ts
# 8C, after 8B merges
pnpm --filter @okf-datahub/query-executor exec vitest run test/db/rollback.test.ts
# 8D, after 8C merges
pnpm --filter @okf-datahub/query-executor exec vitest run test/execution/governed-query.test.ts
```

Expected for each row: FAIL only because that row's implementation is missing;
no command references a later row's path.

- [ ] **Step 3: Implement strict cell parsing and bounded cursor fetch**

Use explicit node-postgres type parsers that return strings. Create `pg-cursor` with `rowMode: "array"`, fetch at most `requestedLimit + 1`, validate every cell, use the extra row only for `truncated`, close the cursor in every path, and measure UTF-8 bytes of the exact result JSON.

```ts
export async function executeAndBufferSelect(
  client: PoolClient,
  query: CompiledSelect,
  freshness: ApplicationQueryFreshnessLease,
  deadline: ExecutionDeadline,
  signal: AbortSignal,
): Promise<
  StageResult<
    BufferedExecutionResult,
    "EXECUTION_TIMEOUT" | "OUTPUT_INVALID" | "INTERNAL_FAILURE"
  >
> {
  consumeApplicationQueryFreshnessLease(freshness);
  let cursor: Cursor | undefined;
  let result: StageResult<
    BufferedExecutionResult,
    "EXECUTION_TIMEOUT" | "OUTPUT_INVALID" | "INTERNAL_FAILURE"
  > = { ok: false, reasonCode: "INTERNAL_FAILURE" };
  try {
    cursor = client.query(new Cursor(
      query.text, [...query.values], { rowMode: "array" },
    ));
    const rows: unknown = await readCursor(
      cursor, query.requestedLimit + 1, deadline, signal,
    );
    result = validateAndSealRows(
      rows, query.resultColumns, query.requestedLimit,
    );
  } catch (error: unknown) {
    result = mapExecutionFailure(error);
  }
  if (cursor !== undefined) {
    const closed = await closeCursorMapped(cursor, deadline, signal);
    if (!closed.ok) return { ok: false, reasonCode: "INTERNAL_FAILURE" };
  }
  return result;
}
```

Immediately before constructing the cursor,
`consumePolicyFreshnessForApplicationQuery` re-reads the trusted clock, checks
the retained deadline and fresh wall horizon, and consumes a single-use
`ApplicationQueryFreshnessLease`. It is the only caller of the module-private
`ApplicationQueryFreshnessLease.revalidateAndCreate`, which is the sole
constructor owner and also checks the shared execution deadline and signal.
`executeAndBufferSelect` requires that lease
in addition to `CompiledSelect`; expiry is a
`RollbackPendingFailure<"POLICY_EXPIRED">` and creates no cursor. The clock
check and `client.query(new Cursor(...))` are one synchronous transition with
no intervening `await` or callback.

Cursor read and close share the exact `ExecutionDeadline` created once before
checkout. Neither operation resets or extends it. If the signal is aborted or
the remaining duration reaches zero before/during close, destroy the client
and discard the private buffer; never wait on an unbounded socket close.

- [ ] **Step 4: Implement rollback-confirmed release**

```ts
// LLM-CONTRACT:
// Accepts: OUTPUT_VALIDATED with rows held in a private sealed buffer.
// Emits: ROLLBACK_CONFIRMED; only that state may construct public rows.
// Failure: destroy client, discard buffer, emit INTERNAL_FAILURE.
// Invariant: no row is observable while the transaction is open or uncertain.
async function rollbackAndRelease(
  transaction: OutputValidatedTransaction,
  deadline: ExecutionDeadline,
  signal: AbortSignal,
): Promise<QueryExecutionOutcome> {
  const confirmation = await rollbackAndConfirm(
    transaction, deadline, signal,
  );
  if (!confirmation.ok) {
    destroyClientAndDiscard(transaction);
    return finalizeRejectedAfterCleanup(
      "INTERNAL_FAILURE", "CLIENT_DESTROYED",
    );
  }
  releaseClient(transaction);
  return releaseValidatedOutput(transaction, confirmation.value);
}
```

`rollbackAndConfirm` is the sole private constructor owner for
`RollbackConfirmed`; it binds the same operation ID as the transaction.
`releaseValidatedOutput` requires that token and consumes the transaction, so
neither rows nor a reusable token remain. A separate
`rollbackPendingFailure(pending, deadline, signal)` follows the same
confirm/destroy disposition with the identical `ExecutionDeadline` and
`AbortSignal`, and calls `finalizeRejectedAfterCleanup` only after cleanup is
known. Statement timeout maps to `EXECUTION_TIMEOUT`; output
failure maps to `OUTPUT_INVALID` only after rollback succeeds. Cursor creation,
read, and close failures are mapped to fixed pending failures; close cannot
throw past this layer or mask an earlier failure. `ROLLBACK`, cursor close, and
cursor read all receive the same non-resetting deadline and `AbortSignal`.
When cleanup cannot start or finish inside the remaining duration, the client
is destroyed synchronously from the pool's perspective and every buffered byte
is discarded. There is no automatic retry.

- [ ] **Step 5: Run result, rollback, and integration tests**

For 8A, 8B, and 8C respectively run only
`test/output/result.test.ts`, `test/db/execute-select.test.ts`, or
`test/db/rollback.test.ts`, followed in every row by:

```bash
pnpm --filter @okf-datahub/query-executor check
pnpm exec biome check apps/query-executor
```

For 8D run:

```bash
pnpm --filter @okf-datahub/query-executor exec vitest run test/output test/db/execute-select.test.ts test/db/rollback.test.ts test/execution/governed-query.test.ts
node apps/query-executor/test/postgres/run-integration-suite.mjs \
  --test test/postgres/rollback.integration.test.ts
pnpm --filter @okf-datahub/query-executor check
pnpm exec biome check apps/query-executor
```

Expected: PASS; success runs exactly one application query and rollback failure
destroys the client with no returned rows. Cancellation or deadline expiry
during cursor close or `ROLLBACK` terminates in `CLIENT_DESTROYED`; delayed
freshness after preflight or schema verification executes zero application
queries.

- [ ] **Step 6: Review and merge each mandatory slice**

Run only the current slice's focused tests, then TypeScript/Biome and the
`code-review` skill. Commit only that row's exclusive files with its named
commit, merge, update `main`, and continue. The 8D integration test must run
through `run-integration-suite.mjs`; no slice may invoke a PostgreSQL integration
test directly or retain its volume.

### Task 9: Runtime dispatcher and readiness

**Branch:** `feat/executor-runtime-wiring`

**Commit:** `feat(query-executor): wire fail-closed runtime`

**Files:**
- Create: `apps/query-executor/src/dispatcher.ts`
- Create: `apps/query-executor/src/readiness.ts`
- Create: `apps/query-executor/src/audit.ts`
- Create: `apps/query-executor/src/config.ts`
- Create: `apps/query-executor/src/main.ts`
- Create: `apps/query-executor/test/dispatcher.test.ts`
- Create: `apps/query-executor/test/executor.e2e.test.ts`
- Modify: `security/security-transitions.v1.json`

**Interfaces:**
- Consumes: verified store, trusted clock, boot attestation, pool, UDS config,
  the transport-created `ExecutionDeadline`, and `AbortSignal`.
- Produces: `createExecutorDispatcher` and `startQueryExecutor`; readiness is true only after all boot attestations and socket binding.

- [ ] **Step 1: Write startup-order and fixed-error tests**

```ts
expect(startupTrace).toEqual([
  "ARTIFACTS_LOADED", "INTEGRITY_VERIFIED", "FRESHNESS_VERIFIED",
  "POOL_CREATED", "ROLE_ATTESTED", "SCHEMA_ATTESTED",
  "RELATION_OID_BOUND", "SOCKET_BOUND", "READY",
]);
```

Assert policy tamper, stale policy, wrong role, schema drift, and wrong socket owner keep readiness false.

- [ ] **Step 2: Run and verify dispatcher/startup failures**

Run: `pnpm --filter @okf-datahub/query-executor exec vitest run test/dispatcher.test.ts test/executor.e2e.test.ts`

Expected: FAIL with missing dispatcher/runtime.

- [ ] **Step 3: Implement the two-operation dispatcher**

Inspection runs preflight and returns a policy summary without pool checkout.
Query execution runs preflight, transaction/schema authorization, compiler,
application-boundary freshness consumption, execution, output validation,
rollback, and fixed response validation. The concrete dispatcher implements
Task 3's unchanged three-argument port and passes the exact transport-owned
deadline and signal through every async boundary; it never derives a duration
or a replacement controller. The dispatcher recomputes the DataHub evidence
digest and rejects operation-ID mismatch.

- [ ] **Step 4: Add fixed failure mapping and audit**

```text
invalid envelope       INVALID_INPUT
artifact mismatch      POLICY_INTEGRITY_FAILED
freshness failure      POLICY_EXPIRED
lock timeout           RESOURCE_BUSY
schema mismatch        DB_SCHEMA_MISMATCH
statement timeout      EXECUTION_TIMEOUT
invalid row            OUTPUT_INVALID
rollback/unknown       INTERNAL_FAILURE
```

Audit uses the same fixed fields as the context plan and never contains SQL, values, results, credentials, client strings, or raw errors.

- [ ] **Step 5: Run the executable E2E gate**

Run:

```bash
pnpm --filter @okf-datahub/query-executor exec vitest run test/dispatcher.test.ts test/executor.e2e.test.ts
pnpm --filter @okf-datahub/query-executor check
pnpm exec biome check apps/query-executor
```

Expected: safe query succeeds; email projection/filter have checkout count zero; safe query has application-query count one; tamper/drift/timeout/cancellation fail closed.

- [ ] **Step 6: Review and commit**

Run the `code-review` skill, then:

```bash
git add apps/query-executor/src apps/query-executor/test/dispatcher.test.ts apps/query-executor/test/executor.e2e.test.ts security/security-transitions.v1.json
git commit -m "feat(query-executor): wire fail-closed runtime"
```

### Task 10: Lean transition proofs and parity gate

**Branch:** `proof/executor-state-invariants`

**Commit:** `proof(query-executor): verify transition invariants`

**Files:**
- Create: `formal/lakefile.toml`
- Create: `formal/lean-toolchain`
- Create: `formal/ExecutorState.lean`
- Create: `formal/PrintAxioms.lean`
- Create: `scripts/check-transition-parity.mjs`
- Create: `apps/query-executor/test/state/transition-parity.test.ts`
- Modify: `security/security-transitions.v1.json`

**Interfaces:**
- Consumes: committed TypeScript transition snapshot.
- Produces: machine-checked proofs that execution requires authorization,
  authorization implies every invariant, pre-query rejection executes no
  application query, post-query rejection records exactly one sent application
  query, and inspection reaches no DB state.

- [ ] **Step 1: Pin Lean and write the failing parity test**

```text
# formal/lean-toolchain
leanprover/lean4:v4.32.1
```

```toml
name = "okf-executor-state"
version = "0.1.0"
defaultTargets = ["ExecutorState"]

[[lean_lib]]
name = "ExecutorState"
roots = ["ExecutorState"]
```

The TypeScript test requires the five theorem names and the exact state-name
set before `formal/ExecutorState.lean` exists.

- [ ] **Step 2: Run and verify incomplete model failure**

Run: `lake -d formal build`

Expected: FAIL until all transition constructors and proofs exist.

- [ ] **Step 3: Implement the verified finite transition model**

```lean
import Std

namespace OkfDataHub

inductive State where
  | envelopeReceived | inputRevalidated | datahubContextRevalidated
  | policyIntegrityVerified | policyFreshnessVerified | resourceVerified
  | policyAllowedPendingSchema | dbTransactionOpen | dbRelationLocked
  | dbSchemaVerified | authorized | sqlCompiled | applicationQuerySent
  | executed | outputValidated | rollbackConfirmed | policySummaryValidated
  | completed | preQueryRejected | postQueryRejected
  deriving DecidableEq, Repr

structure CoreInvariant where
  inputValid : Prop
  contextValid : Prop
  policyIntegrity : Prop
  policyFresh : Prop
  resourceBound : Prop
  fieldUsesAllowed : Prop
  liveSchemaMatches : Prop
  databaseAclSafe : Prop
  inputValidProof : inputValid
  contextValidProof : contextValid
  policyIntegrityProof : policyIntegrity
  policyFreshProof : policyFresh
  resourceBoundProof : resourceBound
  fieldUsesAllowedProof : fieldUsesAllowed
  liveSchemaMatchesProof : liveSchemaMatches
  databaseAclSafeProof : databaseAclSafe

inductive ZeroQueryState : State → Prop where
  | envelopeReceived : ZeroQueryState .envelopeReceived
  | inputRevalidated : ZeroQueryState .inputRevalidated
  | datahubContextRevalidated : ZeroQueryState .datahubContextRevalidated
  | policyIntegrityVerified : ZeroQueryState .policyIntegrityVerified
  | policyFreshnessVerified : ZeroQueryState .policyFreshnessVerified
  | resourceVerified : ZeroQueryState .resourceVerified
  | policyAllowedPendingSchema : ZeroQueryState .policyAllowedPendingSchema
  | dbTransactionOpen : ZeroQueryState .dbTransactionOpen
  | dbRelationLocked : ZeroQueryState .dbRelationLocked
  | dbSchemaVerified : ZeroQueryState .dbSchemaVerified
  | authorized : ZeroQueryState .authorized
  | sqlCompiled : ZeroQueryState .sqlCompiled

inductive OneQueryState : State → Prop where
  | applicationQuerySent : OneQueryState .applicationQuerySent
  | executed : OneQueryState .executed
  | outputValidated : OneQueryState .outputValidated
  | rollbackConfirmed : OneQueryState .rollbackConfirmed

inductive QueryTrace : State → Nat → Prop where
  | envelopeReceived : QueryTrace .envelopeReceived 0
  | inputRevalidated :
      QueryTrace .envelopeReceived 0 → QueryTrace .inputRevalidated 0
  | datahubContextRevalidated :
      QueryTrace .inputRevalidated 0 → QueryTrace .datahubContextRevalidated 0
  | policyIntegrityVerified :
      QueryTrace .datahubContextRevalidated 0 →
        QueryTrace .policyIntegrityVerified 0
  | policyFreshnessVerified :
      QueryTrace .policyIntegrityVerified 0 →
        QueryTrace .policyFreshnessVerified 0
  | resourceVerified :
      QueryTrace .policyFreshnessVerified 0 → QueryTrace .resourceVerified 0
  | policyAllowedPendingSchema :
      QueryTrace .resourceVerified 0 →
        QueryTrace .policyAllowedPendingSchema 0
  | dbTransactionOpen :
      QueryTrace .policyAllowedPendingSchema 0 →
        QueryTrace .dbTransactionOpen 0
  | dbRelationLocked :
      QueryTrace .dbTransactionOpen 0 → QueryTrace .dbRelationLocked 0
  | dbSchemaVerified :
      QueryTrace .dbRelationLocked 0 → QueryTrace .dbSchemaVerified 0
  | authorized :
      QueryTrace .dbSchemaVerified 0 → CoreInvariant →
        QueryTrace .authorized 0
  | sqlCompiled : QueryTrace .authorized 0 → QueryTrace .sqlCompiled 0
  | applicationQuerySent :
      QueryTrace .sqlCompiled 0 → QueryTrace .applicationQuerySent 1
  | executed :
      QueryTrace .applicationQuerySent 1 → QueryTrace .executed 1
  | outputValidated : QueryTrace .executed 1 → QueryTrace .outputValidated 1
  | rollbackConfirmed :
      QueryTrace .outputValidated 1 → QueryTrace .rollbackConfirmed 1
  | completed : QueryTrace .rollbackConfirmed 1 → QueryTrace .completed 1
  | preQueryRejected {state : State} :
      ZeroQueryState state →
        QueryTrace state 0 → QueryTrace .preQueryRejected 0
  | postQueryRejected {state : State} :
      OneQueryState state →
        QueryTrace state 1 → QueryTrace .postQueryRejected 1

inductive InspectTrace : State → Prop where
  | envelopeReceived : InspectTrace .envelopeReceived
  | inputRevalidated :
      InspectTrace .envelopeReceived → InspectTrace .inputRevalidated
  | datahubContextRevalidated :
      InspectTrace .inputRevalidated → InspectTrace .datahubContextRevalidated
  | policyIntegrityVerified :
      InspectTrace .datahubContextRevalidated →
        InspectTrace .policyIntegrityVerified
  | policyFreshnessVerified :
      InspectTrace .policyIntegrityVerified →
        InspectTrace .policyFreshnessVerified
  | resourceVerified :
      InspectTrace .policyFreshnessVerified → InspectTrace .resourceVerified
  | policySummaryValidated :
      InspectTrace .resourceVerified → InspectTrace .policySummaryValidated
  | completed : InspectTrace .policySummaryValidated → InspectTrace .completed
  | preQueryRejected {state : State} :
      InspectTrace state → InspectTrace .preQueryRejected

def IsDbState : State → Prop
  | .dbTransactionOpen | .dbRelationLocked | .dbSchemaVerified
  | .authorized | .sqlCompiled | .applicationQuerySent | .executed
  | .outputValidated | .rollbackConfirmed => True
  | _ => False

theorem executed_only_after_authorized
    (h : QueryTrace .executed 1) : QueryTrace .authorized 0 := by
  cases h with
  | executed sent =>
      cases sent with
      | applicationQuerySent compiled =>
          cases compiled with
          | sqlCompiled authorized => exact authorized

theorem authorized_implies_core_invariant
    (h : QueryTrace .authorized 0) :
    ∃ inv : CoreInvariant,
      inv.inputValid ∧ inv.contextValid ∧ inv.policyIntegrity ∧
      inv.policyFresh ∧ inv.resourceBound ∧ inv.fieldUsesAllowed ∧
      inv.liveSchemaMatches ∧ inv.databaseAclSafe := by
  cases h with
  | authorized _ inv =>
      exact ⟨inv, inv.inputValidProof, inv.contextValidProof,
        inv.policyIntegrityProof, inv.policyFreshProof,
        inv.resourceBoundProof, inv.fieldUsesAllowedProof,
        inv.liveSchemaMatchesProof, inv.databaseAclSafeProof⟩

theorem prequery_rejection_has_zero_application_queries
    {count : Nat} (h : QueryTrace .preQueryRejected count) : count = 0 := by
  cases h
  rfl

theorem postquery_rejection_has_one_application_query
    {count : Nat} (h : QueryTrace .postQueryRejected count) : count = 1 := by
  cases h
  rfl

theorem inspection_never_reaches_database
    {state : State} (h : InspectTrace state) : ¬ IsDbState state := by
  cases h <;> simp [IsDbState]

end OkfDataHub
```

This exact model must compile under pinned Lean 4.32.1. It proves control-flow
structure only; it does not assert PostgreSQL or DataHub semantic correctness.

- [ ] **Step 4: Add anti-bypass CI checks**

`check-transition-parity.mjs` rejects `sorry`, `axiom`, `admit`, transition
name drift, missing TypeScript `LLM-CONTRACT` comments, and any theorem removed
from the expected theorem list. It also invokes a compiled Lean environment
query equivalent to `#print axioms` for each of the five named theorems and
requires an empty dependency set; source-text scanning alone is not proof of
axiom freedom.

- [ ] **Step 5: Run proof and parity gates**

Run:

```bash
lake -d formal build
lake -d formal env lean formal/PrintAxioms.lean
pnpm --filter @okf-datahub/query-executor exec vitest run test/state/transition-parity.test.ts
node scripts/check-transition-parity.mjs
node scripts/check-tcb.mjs --manifest security/security-transitions.v1.json --roots executor,integration
```

Expected: PASS with no sorry or added axiom.

- [ ] **Step 6: Review and commit**

Run the `code-review` skill, then:

```bash
git add formal scripts/check-transition-parity.mjs apps/query-executor/test/state/transition-parity.test.ts security/security-transitions.v1.json
git commit -m "proof(query-executor): verify transition invariants"
```

## Plan Completion Gate

Run:

```bash
pnpm exec tsc -b --pretty false
pnpm exec tsc -p apps/query-executor/tsconfig.test.json --noEmit
pnpm exec biome check apps/query-executor packages/contracts
pnpm --filter @okf-datahub/query-executor test
node apps/query-executor/test/postgres/run-integration-suite.mjs --all
node scripts/check-tcb.mjs --manifest security/security-transitions.v1.json --roots contracts,executor,integration
node scripts/check-security-shell.mjs security/security-shell-transitions.v1.json
node scripts/check-security-sql.mjs security/security-sql-transitions.v1.json
lake -d formal build
lake -d formal env lean formal/PrintAxioms.lean
node scripts/check-transition-parity.mjs
git diff --check
```

Expected: all commands pass; source and dependency scans confirm no MCP SDK,
YAML parser/compiler, DataHub client/token, shell, package manager, or
executable email projection/filter/compiler branch exists in the executor
runtime closure.
