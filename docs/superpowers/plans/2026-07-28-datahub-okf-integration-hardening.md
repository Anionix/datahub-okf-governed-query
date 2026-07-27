# DataHub OKF Integration and Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assemble the pinned DataHub, PostgreSQL, context MCP, and executor into an isolated real-service demo with adversarial, privilege, supply-chain, and release evidence.

**Architecture:** Build inputs and public images are locked to immutable digests before Compose rendering. An ephemeral trusted bootstrap seeds synthetic DataHub metadata and a dataset-scoped read-only service account, then runtime containers communicate only through separate internal metadata/database networks and a dedicated tmpfs Unix-socket volume.

**Tech Stack:** DataHub Core v1.6.0, DataHub MCP v0.6.0, PostgreSQL 18.4, Docker Buildx/Compose, TypeScript/Vitest, Nix, Syft, Grype, Gitleaks

## Global Constraints

- Use exactly one synthetic dataset, `demo.analytics.customer_orders`; no
  second synthetic dataset, real data, external deployment, HTTP MCP, multi-user
  access, runtime DataHub mutation, policy publication, or writeback.
- Use one branch and one task per PR, target 150–220 changed lines excluding
  only `LLM-CONTRACT` comments, and run the `code-review` skill before every
  PR. Generated lock data counts toward the limit.
- A numbered section with a mandatory `Delivery` table is an umbrella work
  package, not a PR. Each row is the actual task/branch/PR; a combined umbrella
  PR is forbidden. Unsliced numbered sections remain one task/PR and must be
  split before review if their authored diff materially exceeds the target.
- Pin DataHub Core v1.6.0 commit `059a36c0b035a6057de00114ccac0ea9003d6bc2`, DataHub MCP v0.6.0 commit `9a6946daa7d30eb481c82dd8ee5e15ae6526a3c9`, PostgreSQL 18.4, Node 24.18.0, MCP SDK 1.29.0, and OKF commit `3fcbb9f828c2f23d109c855ee403c3a4c81f3a96` with raw digest `5a3311d270bebb16d558010e75064f5b75323f284992641732b1c8097511f948`.
- Release Compose accepts only `image@sha256:<64 lowercase hex>` and rejects every tag, floating source, uncommitted generated artifact, or dependency lock drift.
- The sole release platform is `linux/amd64`. Source and local image locks bind
  that literal platform; host defaults, `linux/arm64`, manifest-list digests,
  and per-host lock rewrites are rejected. Apple Silicon development uses
  Buildx emulation for the same reviewed artifact.
- `context-mcp` and `query-executor` use different fixed non-root UIDs, read-only roots, dropped capabilities, `no-new-privileges`, separate tmpfs, secrets, process namespaces, and networks.
- `context-mcp` has only metadata-API reachability and its DataHub token; it
  cannot reach DataHub's unauthenticated MySQL, Elasticsearch, Kafka, Schema
  Registry, ZooKeeper, or upgrade backplane. `query-executor` has only private
  PostgreSQL reachability and its database secret.
- The only bridge is `/run/okf-executor/executor.sock` in a dedicated shared tmpfs volume: directory `0710`, socket `0660`, executor UID `10002`, shared GID `10003`; only context UID `10001` and executor UID `10002` receive that supplementary group.
- The DataHub service account can read only the fixed dataset/schema evidence required by the two allowlisted tools. It cannot edit metadata, create/approve proposals, manage policies, manage tokens, or administer DataHub.
- Runtime assertions inspect actual containers, mounts, UIDs, capabilities, network routes, ACLs, and tokens; Compose declarations alone are not evidence.
- Every release gate is mandatory; any failure is `NO-GO`.

---

## Dependency Order

This is Stage 3. Start only after every foundation, context-MCP, and
query-executor task PR is merged and the protected policy artifacts are
available. Execute 1A–1B, 2A–2C, 3A–3D, 4A–4B, 5A–5D, and
6A–6B in order; each branch starts from updated `main`
after the preceding task PR is merged. Do not build local images in Task 1:
their Dockerfiles first exist in Task 3.

---

## Key File Map (non-exhaustive)

For a mandatory `Delivery` table, each row's `Files` cell is exhaustive and
authoritative and the section-level Files list is only their union. This map
only shows the paths most useful for orientation.

```text
infra/datahub/upstream-v1.6.0.yaml             reviewed official Quickstart source
infra/datahub/metadata-proposals.json          synthetic dataset/tag/schema aspects
infra/datahub/bootstrap.mjs                    seed, account, policy, token bootstrap
infra/datahub/read-policy.graphql              dataset-scoped read grant
infra/images.source.json                       exact tag/source input list
infra/images.lock.json                         resolved immutable image digests
scripts/lock-images.mjs                        digest resolver
scripts/render-compose.mjs                     tag-free release compose renderer
infra/compose.locked.yaml                       generated runtime topology
apps/context-mcp/Dockerfile                    context plus pinned Python child
apps/query-executor/Dockerfile                 minimal executor plus artifacts
tests/integration/*.test.ts                    real-service and attack tests
scripts/assert-runtime-isolation.mjs           container/network/mount assertions
scripts/release-check.mjs                      aggregate mandatory gate
docs/demo-runbook.md                           deterministic hackathon presentation
docs/security-claims.md                        scoped claims and residual risks
```

### Task 1: Primary-source and image digest locks

**Delivery:** This section is an umbrella only.

| Task | Branch | Files (exhaustive) | Commit |
|---|---|---|---|
| 1A — source and image lock | `build/pin-runtime-images` | Create `infra/datahub/upstream-v1.6.0.yaml`, `infra/images.source.json`, `infra/images.lock.json`, `scripts/lock-images.mjs`, `scripts/test/lock-images.test.mjs`; modify `security/security-transitions.v1.json` | `build: lock primary sources and container images` |
| 1B — locked renderer | `build/render-locked-compose` | Create `scripts/render-compose.mjs`, `scripts/test/render-compose.test.mjs`; modify `security/security-transitions.v1.json` | `build: render only locked runtime topology` |

1A runs only the lock test, raw source rehash, public/BuildKit OCI resolver, and
`--verify-public`. 1B runs only the renderer test plus 1A's non-writing lock
verification. It expects local application digests to be absent and proves the
renderer refuses release output. Neither row invokes a file owned by the next.

**Files:**
- Create: `infra/datahub/upstream-v1.6.0.yaml`
- Create: `infra/images.source.json`
- Create: `infra/images.lock.json`
- Create: `scripts/lock-images.mjs`
- Create: `scripts/render-compose.mjs`
- Create: `scripts/test/lock-images.test.mjs`
- Create: `scripts/test/render-compose.test.mjs`
- Modify: `security/security-transitions.v1.json`

**Interfaces:**
- Consumes: exact upstream public image references.
- Produces: immutable vendored-source/public-image locks plus a release renderer
  that rejects both tags and an incomplete local-image lock.

- [ ] **Step 1: Vendor the reviewed upstream compose bytes**

Run:

```bash
gh api 'repos/datahub-project/datahub/contents/docker/quickstart/docker-compose-without-neo4j.quickstart.yml?ref=059a36c0b035a6057de00114ccac0ea9003d6bc2' \
  -H 'Accept: application/vnd.github.raw+json' \
  > infra/datahub/upstream-v1.6.0.yaml
shasum -a 256 infra/datahub/upstream-v1.6.0.yaml
```

Require the returned raw SHA-256 to equal
`1fc33ca664b715128939ebe99332110ebc920bd320ceae832ec7cb4acfbfdb75`
and record it beside the exact repository, commit, and path. The lock test
rehashes the vendored bytes.

- [ ] **Step 2: Define the complete source image set**

```json
{
  "apiVersion": "image-sources/v1",
  "releasePlatform": "linux/amd64",
  "images": [
    "acryldata/datahub-gms:v1.6.0",
    "acryldata/datahub-upgrade:v1.6.0",
    "confluentinc/cp-kafka:7.9.2",
    "confluentinc/cp-schema-registry:7.9.2",
    "confluentinc/cp-zookeeper:7.9.2",
    "elasticsearch:7.10.1",
    "mysql:8.2",
    "postgres:18.4-bookworm",
    "node:24.18.0-bookworm-slim",
    "python:3.12.11-slim-bookworm",
    "gcr.io/distroless/nodejs24-debian12:nonroot",
    "ghcr.io/astral-sh/uv:0.11.32",
    "moby/buildkit:buildx-stable-1",
    "registry:2"
  ],
  "localImages": [
    "127.0.0.1:5000/okf-context-mcp:0.1.0",
    "127.0.0.1:5000/okf-query-executor:0.1.0"
  ],
  "builder": {
    "source": "moby/buildkit:buildx-stable-1",
    "indexDigest": "sha256:2f5adac4ecd194d9f8c10b7b5d7bceb5186853db1b26e5abd3a657af0b7e26ec",
    "platform": "linux/amd64",
    "manifestDigest": "sha256:63db51c9b30208a7c2b1c40392c7ebb9ce2f85ba238a18a85420f8f5ea2d4684",
    "version": "v0.31.2",
    "sourceRevision": "e42e1bfd389af7203238cce77b1f7dad447285e9"
  }
}
```

The initial reviewed public lock is:

```json
{
  "apiVersion": "image-lock/v1",
  "platform": "linux/amd64",
  "images": {
    "acryldata/datahub-gms:v1.6.0": "sha256:672bceed7f36f751ab3302c30826c6ba124d1c0fd8d24c3724e725078b864018",
    "acryldata/datahub-upgrade:v1.6.0": "sha256:6e6b9f09165007004c20e9387e6ca1a171d1425fd76ae807b217c5dc7883ff02",
    "confluentinc/cp-kafka:7.9.2": "sha256:ecd1ce3c902fb5cfa7fc34881215f1a3e1abdcba5d0d9bbe6b0385ff6425e05c",
    "confluentinc/cp-schema-registry:7.9.2": "sha256:d92bd8a12290d131f77eca1daeb524d835728b597b698617a496904f40b16fc9",
    "confluentinc/cp-zookeeper:7.9.2": "sha256:c03f6fe4af97d57c42518b8deaf2753ed338ee414812f258f9cf32c977fe0a53",
    "elasticsearch:7.10.1": "sha256:7cd88158f6ac75d43b447fdd98c4eb69483fa7bf1be5616a85fe556262dc864a",
    "mysql:8.2": "sha256:212fe73edca5df6ff14826d5eb975c914bfb91f82a2e923f9050568f99525da1",
    "postgres:18.4-bookworm": "sha256:1961f96e6029a02c3812d7cb329a3b03a3ac2bb067058dec17b0f5596aca9296",
    "node:24.18.0-bookworm-slim": "sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d",
    "python:3.12.11-slim-bookworm": "sha256:519591d6871b7bc437060736b9f7456b8731f1499a57e22e6c285135ae657bf7",
    "gcr.io/distroless/nodejs24-debian12:nonroot": "sha256:14d42e2511532589a7c7e01a753667a74fcc96266e137e8125006b87b0c32d0a",
    "ghcr.io/astral-sh/uv:0.11.32": "sha256:df4cae8f3a96d175e2e5f992e597550000edbe78fdc2594d5cd8de1a217f504c",
    "moby/buildkit:buildx-stable-1": "sha256:63db51c9b30208a7c2b1c40392c7ebb9ce2f85ba238a18a85420f8f5ea2d4684",
    "registry:2": "sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373"
  }
}
```

The BuildKit source entry additionally records parent OCI index
`sha256:2f5adac4ecd194d9f8c10b7b5d7bceb5186853db1b26e5abd3a657af0b7e26ec`,
selected platform `linux/amd64`, selected child manifest
`sha256:63db51c9b30208a7c2b1c40392c7ebb9ce2f85ba238a18a85420f8f5ea2d4684`,
BuildKit version `v0.31.2`, and source revision
`e42e1bfd389af7203238cce77b1f7dad447285e9`. The resolver repeats the OCI
selection and rejects a direct tag, parent index used as a child, extra
platform selection, or annotation mismatch.

The renderer retains GMS, system-upgrade, Kafka, Schema Registry, ZooKeeper,
Elasticsearch, and MySQL. It omits the UI and Actions because the adapter needs
only GMS. The pinned DataHub v1.6.0 compose also refers to
`acryldata/datahub-kafka-setup:v1.6.0`, but that public tag does not exist; the
renderer removes both that service and
`datahub-upgrade.depends_on.kafka-setup`, then explicitly sets
`KAFKA_AUTO_CREATE_TOPICS_ENABLE=true`. It never substitutes `head`.

The vendored Quickstart is an input, not a trusted runtime configuration.
`render-compose.mjs` applies a closed transformation and then validates the
result:

- remove the upstream `default` network; attach context/bootstrap and GMS to
  `metadata_api_net`, attach GMS plus every retained DataHub backend to
  `datahub_backend_net`, and never attach context/bootstrap to that backplane;
- remove every upstream `ports`, `${HOME}/.datahub/plugins` mount, UI/Actions
  service, and unreviewed host bind;
- force `METADATA_SERVICE_AUTH_ENABLED=true` and
  `REST_API_AUTHORIZATION_ENABLED=true`, and
  `DATAHUB_TELEMETRY_ENABLED=false`;
- replace the GMS command with the reviewed authenticated-start wrapper, which
  reads signing key/salt from the GMS-only tmpfs and system-client secret from
  a separate bootstrap-shared tmpfs, all as `0400` files, and then `exec`s the
  pinned upstream start script;
- reject any remaining interpolation except the three fixed secret-file paths,
  any service/image outside the allowlist, any release host port, any default
  network, or any dependency on the removed `kafka-setup` service.

`--bootstrap-test` is the sole exception to the no-port rule: it requires
exactly `127.0.0.1:18080:8080` for the Task 2 local test process and is never
accepted by `--release`. The real-service gate must prove the upgrade completes,
required topics appear through broker auto-creation, GMS becomes healthy,
unauthenticated GraphQL returns `401`, and an authenticated fixed-dataset read
succeeds.

- [ ] **Step 3: Write tests that reject tags and invalid digests**

```js
assert.throws(() => renderImage("postgres:18.4-bookworm"), /digest required/);
assert.equal(
  renderImage("postgres@sha256:" + "a".repeat(64)),
  "postgres@sha256:" + "a".repeat(64),
);
assert.throws(
  () => validateLock({ image: "postgres", digest: "sha256:ABC" }),
  /invalid digest/,
);
assert.throws(
  () => renderRelease(publicOnlyLock),
  /local image digest missing/,
);
assert.throws(() => renderRelease(upstreamWithHostPort), /host port forbidden/);
assert.throws(() => renderRelease(upstreamWithHomeMount), /host bind forbidden/);
assert.throws(() => renderRelease(upstreamWithDefaultNetwork), /default network forbidden/);
assert.throws(() => renderRelease(authDisabled), /GMS authentication required/);
assert.throws(() => renderRelease(upgradeDependingOnKafkaSetup), /removed dependency/);
```

- [ ] **Step 4: Implement deterministic digest resolution**

```js
export function resolveDigest(image) {
  const raw = execFileSync(
    "docker",
    ["buildx", "imagetools", "inspect", image, "--raw"],
    { encoding: "buffer", maxBuffer: 2_097_152 },
  );
  const index = parseStrictBoundedOciIndex(raw);
  const candidates = index.manifests.filter((descriptor) =>
    descriptor.platform.os === "linux" &&
    descriptor.platform.architecture === "amd64" &&
    descriptor.platform.variant === undefined &&
    descriptor.annotations?.["vnd.docker.reference.type"] !== "attestation-manifest"
  );
  if (candidates.length !== 1) throw new Error("linux/amd64 child ambiguous");
  const child = candidates[0];
  verifyChildManifestAndConfigPlatform(image, child.digest, "linux", "amd64");
  return child.digest;
}
```

`parseStrictBoundedOciIndex` accepts only a 2 MiB UTF-8 OCI/Docker index with
at most 64 strict descriptors and lowercase SHA-256 digests. It rejects a
single-manifest response for a public discovery tag, duplicate
`linux/amd64` children, variants, missing platform metadata, unknown media
types, and attestation descriptors masquerading as runnable children.
`verifyChildManifestAndConfigPlatform` inspects `repository@childDigest`,
requires a single image manifest (not another index), verifies its config blob,
and requires config `os=linux`, `architecture=amd64`, and no variant before
returning. Tests prove the parent index digest is never stored, the unique child
is stored, and duplicate/attestation/wrong-config cases reject.

Sort lock entries by source reference, include the resolved timestamp only in
an untrusted audit sidecar, and write no timestamp into
`infra/images.lock.json`. The explicit maintainer command
`node scripts/lock-images.mjs --update-public` resolves only the public
`images` set; it never tries to build or resolve `localImages`. Normal CI uses
the non-writing `--verify-public`, requires every committed digest still has the
exact `linux/amd64` descriptor, rejects a multi-platform manifest-list digest,
and reports tag drift without rewriting the lock. `--update-public`,
`--local`, and `--verify-local` all reject any other platform before invoking
Docker. Tags are mutable discovery inputs; only the reviewed committed
platform-specific digests are release authorities.

- [ ] **Step 5: Resolve the public lock, test incompleteness rejection, review, and commit**

Run:

```bash
node scripts/lock-images.mjs --update-public
node --test scripts/test/lock-images.test.mjs scripts/test/render-compose.test.mjs
node scripts/lock-images.mjs --verify-public
git diff --check
```

Expected: PASS; the public lock is complete and deterministic, and the renderer
refuses to create release Compose because both local digests are intentionally
absent. Run the `code-review` skill, then:

```bash
git add -- <every path in the current Delivery row Files cell, and no other path>
git commit -m "<that row's exact Commit cell>"
```

### Task 2: Synthetic DataHub metadata and least-privilege service account

**Delivery:** This section is an umbrella only.

| Task | Branch | Files (exhaustive) | Commit |
|---|---|---|---|
| 2A — metadata bootstrap core | `feat/datahub-metadata-bootstrap` | Create `infra/datahub/metadata-proposals.json`, `infra/datahub/read-policy.graphql`, `infra/datahub/bootstrap.mjs`, `infra/datahub/bootstrap-state.schema.json`, `tests/integration/datahub-bootstrap.test.ts`; modify `security/security-transitions.v1.json` | `feat(datahub): define synthetic metadata bootstrap` |
| 2B — authenticated shell boundary | `feat/datahub-auth-bootstrap` | Create `infra/datahub/bootstrap.compose.yaml`, `infra/datahub/start-gms-authenticated.sh`, `infra/datahub/provision-auth-secrets.sh`, `scripts/create-datahub-secrets.mjs`; modify `security/security-shell-transitions.v1.json`, `scripts/check-security-shell.mjs`, `scripts/test/check-security-shell.test.mjs`, `security/security-transitions.v1.json` | `feat(datahub): enforce authenticated bootstrap boundary` |
| 2C — privilege lifecycle | `test/datahub-reader-privileges` | Create `scripts/test-datahub-bootstrap.mjs`, `tests/integration/datahub-token-privileges.test.ts`; modify `tests/integration/datahub-bootstrap.test.ts`, `security/security-transitions.v1.json` | `test(datahub): prove fixed reader privileges` |

2A uses a fake authenticated GMS port to test the closed metadata/proposal and
crash-state machine without Compose. 2B runs shell-TCB/ShellCheck and the
authenticated GMS bootstrap-compose smoke. 2C creates the sole clean lifecycle
runner and runs the real bootstrap and token-privilege tests. Each row reruns
the TCB roots it changes.

**Files:**
- Create: `infra/datahub/metadata-proposals.json`
- Create: `infra/datahub/read-policy.graphql`
- Create: `infra/datahub/bootstrap.mjs`
- Create: `infra/datahub/bootstrap-state.schema.json`
- Create: `infra/datahub/bootstrap.compose.yaml`
- Create: `infra/datahub/start-gms-authenticated.sh`
- Create: `infra/datahub/provision-auth-secrets.sh`
- Modify: `security/security-shell-transitions.v1.json`
- Modify: `scripts/check-security-shell.mjs`
- Modify: `scripts/test/check-security-shell.test.mjs`
- Create: `scripts/create-datahub-secrets.mjs`
- Create: `scripts/test-datahub-bootstrap.mjs`
- Create: `tests/integration/datahub-bootstrap.test.ts`
- Create: `tests/integration/datahub-token-privileges.test.ts`
- Modify: `security/security-transitions.v1.json`

**Interfaces:**
- Consumes: a root bootstrap session minted through DataHub's fixed system-client
  endpoint, three file-backed GMS authentication secrets, and synthetic aspect
  JSON. Task 2 uses the single loopback-only bootstrap-test port; release setup
  runs the same bootstrap code as a one-shot service on `metadata_api_net`.
- Produces: exact dataset/schema/tag metadata plus a one-day service-account
  token written once to the dedicated shared-tmpfs path
  `/run/datahub-token/token`, plus a token-free teardown state file at
  `/run/bootstrap-state/datahub-bootstrap.v1.json`. The Task 2 loopback harness
  substitutes ignored `work/runtime-state` and `work/secrets` paths only for its
  host-side contract tests, then removes both in `finally`.

The two new DataHub shell entrypoints extend the closed shell TCB that already
contains the PostgreSQL role wrapper. Each has a literal shebang followed by
the exact four `# LLM-CONTRACT` Accepts/Emits/Failure/Invariant lines.
`security-shell-transitions.v1.json` contains all three repository paths,
`<top-level>` symbol, raw SHA-256, and exact clause strings, sorted by path.
`check-security-shell.mjs` rejects an extra/missing/renamed shell authority,
clause or digest drift, CRLF/NUL, `eval`, `source`, backticks, dynamic command
names, network clients, unbounded reads, and shell files outside the
three-path
allowlist; it then invokes pinned ShellCheck at error severity. Tests cover
every rejection. The general TypeScript AST gate does not claim to scan shell.

- [ ] **Step 1: Define exact synthetic metadata**

The proposal set creates:

```json
{
  "datasetUrn": "urn:li:dataset:(urn:li:dataPlatform:postgres,demo.analytics.customer_orders,PROD)",
  "platformUrn": "urn:li:dataPlatform:postgres",
  "tagUrn": "urn:li:tag:PII",
  "fields": [
    {"fieldPath":"customer_id","nativeDataType":"text","type":"STRING"},
    {"fieldPath":"email","nativeDataType":"text","type":"STRING","tagUrns":["urn:li:tag:PII"]},
    {"fieldPath":"total","nativeDataType":"numeric(12,2)","type":"NUMBER"},
    {"fieldPath":"status","nativeDataType":"text","type":"STRING"},
    {"fieldPath":"placed_on","nativeDataType":"date","type":"DATE"}
  ]
}
```

`bootstrap.mjs` converts this closed fixture into DataHub `datasetProperties`, `schemaMetadata`, `status`, `dataPlatformInfo`, and `tagProperties` proposals and posts them to the pinned GMS ingest endpoint. It refuses any additional dataset, field, aspect, URL, owner, description, or tag.
The fixed negative-control URN
`urn:li:dataset:(urn:li:dataPlatform:postgres,demo.analytics.unbound_control,PROD)`
is never ingested. Root readback must prove it does not exist; it is used only
to prove that the reader has no privilege outside the one real resource.

- [ ] **Step 2: Add the dataset-scoped metadata policy document**

```graphql
mutation CreateReaderPolicy($actor: String!, $dataset: String!) {
  createPolicy(input: {
    type: METADATA
    name: "OKF Context MCP fixed dataset read"
    state: ACTIVE
    description: "Read-only evidence for the synthetic governed-query demo"
    resources: {resources: [$dataset], allResources: false}
    privileges: [
      "VIEW_ENTITY_PAGE"
    ]
    actors: {
      users: [$actor]
      groups: []
      resourceOwners: false
      resourceOwnersTypes: []
      allUsers: false
      allGroups: false
    }
  })
}
```

This one-privilege set is derived from both pinned implementations, not from a
UI-role guess:

- DataHub MCP
  [`entities.py`](https://github.com/acryldata/mcp-server-datahub/blob/9a6946daa7d30eb481c82dd8ee5e15ae6526a3c9/src/mcp_server_datahub/tools/entities.py)
  implements both `get_entities` and `list_schema_fields` with an entity
  existence check followed by the `GetEntity` GraphQL operation. Its optional
  related-document lookup is caught on denial and is not part of this
  adapter's evidence contract.
- DataHub Core
  [`PoliciesConfig.java`](https://github.com/datahub-project/datahub/blob/059a36c0b035a6057de00114ccac0ea9003d6bc2/metadata-utils/src/main/java/com/linkedin/metadata/authorization/PoliciesConfig.java#L1028-L1062)
  defines the API privilege sets as disjunctions and lists
  `VIEW_ENTITY_PAGE` as sufficient for both ENTITY `READ` and ENTITY `EXISTS`.

Therefore `SEARCH_PRIVILEGE`, count/time-series/timeline/REST entity
privileges, and Elasticsearch explain access are forbidden. The real-service
characterization in Task 4 must prove both allowlisted MCP tools succeed with
only `VIEW_ENTITY_PAGE` and fail when that policy is inactive. If the pinned
runtime disagrees, release is `NO-GO`; implementation must not widen the
privilege set to make the demo pass.

Before creating this policy, bootstrap reads and requires the exact three
editable boot policies from DataHub Core v1.6.0:

```text
urn:li:dataHubPolicy:7                         All Users - Base Platform Privileges
urn:li:dataHubPolicy:view-entity-page-all      All Users - View Entity Page
urn:li:dataHubPolicy:view-dataset-sensitive    All Users - View Dataset Sensitive Information
```

For each policy it requires the exact URN/display name, `editable: true`,
`actors.allUsers: true`, and the reviewed type, resources, privileges, and
actors. It then round-trips every field unchanged except `state: INACTIVE`
through the v1.6.0 schema:

```graphql
mutation SetBootPolicyInactive(
  $urn: String!
  $input: PolicyUpdateInput!
) {
  updatePolicy(urn: $urn, input: $input)
}
```

Any missing, additional, renamed, already modified, or non-editable boot policy
is a bootstrap failure. Root's non-editable policies remain active. After
creating the dataset policy, bootstrap calls `getGrantedPrivileges` for the
service actor and exact resource and requires precisely
`["VIEW_ENTITY_PAGE"]`, with no platform privileges. It also proves the fixed
unbound-control URN does not exist and requires empty metadata and platform
privilege sets for that URN.

- [ ] **Step 3: Write bootstrap and negative privilege tests first**

```ts
it.each(validMutationFixtures)(
  "returns authorization denial and leaves state unchanged: $name",
  async ({ document, variables, readback }) => {
    const before = await readback(rootClient);
    const denied = await graphQl(readerClient, document, variables);
    expect(denied.errors?.map((error) => error.extensions))
      .toStrictEqual([{ code: 403, type: "UNAUTHORIZED" }]);
    expect(await readback(rootClient)).toStrictEqual(before);
  },
);

it("denies a valid REST ingest proposal", async () => {
  const before = await getAspectAsRoot(DATASET_URN, "datasetProperties");
  expect(await ingestProposalAsReader(validChangedPropertiesProposal()))
    .toMatchObject({ status: 403 });
  expect(await getAspectAsRoot(DATASET_URN, "datasetProperties"))
    .toStrictEqual(before);
});

it("pins the reader to one privilege on one existing dataset", async () => {
  expect(await getGrantedPrivilegesAsRoot(READER_ACTOR, DATASET_URN))
    .toStrictEqual({
      metadataPrivileges: ["VIEW_ENTITY_PAGE"],
      platformPrivileges: [],
    });
  expect(await entityExistsAsRoot(UNBOUND_CONTROL_URN)).toBe(false);
  expect(await getGrantedPrivilegesAsRoot(READER_ACTOR, UNBOUND_CONTROL_URN))
    .toStrictEqual({ metadataPrivileges: [], platformPrivileges: [] });
  expect(await getEntityAsReader(UNBOUND_CONTROL_URN))
    .toBeNotFoundOrUnauthorized();
});
```

`validMutationFixtures` contains the exact v1.6.0 `addTag`, `createPolicy`,
`createAccessToken` (type `SERVICE_ACCOUNT`, existing service actor, `ONE_DAY`),
and `createServiceAccount` documents. Bootstrap first runs each same
document/variable shape as root, verifies success, and reverses it. `addTag`
targets the sole `customer_orders` dataset with a fixed disposable non-PII tag;
the other controls are policy, service-account, and token objects. Cleanup
removes/revokes those non-dataset controls and restores the dataset's exact
tag readback. No control dataset is ever created. Therefore
parse/validation/not-found errors cannot satisfy the reader-denial test.
Assertions compare only fixed error extensions, never raw messages.

- [ ] **Step 4: Create the service identity and one-time token**

```graphql
mutation CreateService {
  createServiceAccount(input: {
    displayName: "OKF Context MCP"
    description: "Read-only synthetic DataHub evidence"
  }) { urn }
}

mutation CreateToken($actor: String!) {
  createAccessToken(input: {
    type: SERVICE_ACCOUNT
    actorUrn: $actor
    duration: ONE_DAY
    name: "okf-context-mcp-demo"
    description: "Ephemeral local hackathon token"
  }) {
    accessToken
    metadata { id }
  }
}
```

Write the token with owner UID 10001 and mode `0400` to a dedicated
`datahub_token` tmpfs volume; context mounts that volume read-only and executor
does not mount it. Store only the returned token ID in the protected test
harness state for teardown revocation. The atomic state file has directory mode
`0700`, file mode `0600`, validates against
`bootstrap-state.schema.json`, and contains only its version, service-account
URN, token ID, created reader-policy URN, non-dataset control policy/tag URNs,
the three boot-policy URNs plus their complete original update inputs, fixed
resource URNs, and a closed phase
(`PREPARED`, `POLICIES_DISABLED`, `ENTITIES_CREATED`, `SERVICE_CREATED`,
`TOKEN_CREATED`, `READY`). It contains no access token or root credential.
Not-yet-observed remote IDs are explicit `null` values rather than omitted
fields; unknown keys and empty-string sentinels reject.
It also contains an exact ordered `effects` array. Each record has a fixed
effect ID, deterministic target/fingerprint, `PREPARED` or `APPLIED`, and only
the remote ID/readback needed for cleanup. Before every external mutation,
setup atomically writes its `PREPARED` record; after the API succeeds it performs
bounded exact readback/reconciliation, records all returned IDs, and only then
atomically marks `APPLIED` and advances the aggregate phase.

Before setup, root readback requires zero pre-existing objects with the fixed
service display-name/description, policy name/type/resource tuple, and token
name/actor/description tuple. Dataset/tag URNs and policy identifiers are
deterministic. Where DataHub assigns an ID (service account or token), recovery
uses the pinned v1.6.0 list/read APIs to enumerate a bounded complete set and
match the entire prepared fingerprint, not a partial name. An API success
followed by a crash before journal rename is therefore reconciled: recovery
finds and deletes/revokes every exact match, including a token whose plaintext
was never durably written. Zero, duplicate, truncated, or ambiguous readback is
cleanup `NO-GO` after all safely identifiable matches are revoked.

A pre-existing non-`READY` state refuses normal setup and requires idempotent
`--recover`. Recovery first reconciles every `PREPARED` and `APPLIED` effect
against remote state, persists the discovered IDs, then walks effects in
reverse and verifies restoration. It never assumes that a missing local ID
means the remote side effect did not occur.
`bootstrap.mjs --teardown` is a separate process that reads this exact file,
uses the bootstrap-only admin credential, revokes and verifies the token,
deletes the created policy and service account, restores the three original
boot-policy states, then atomically removes the state file. Never write the
token to stdout/stderr/image/lock. The bootstrap container exits and is removed
before runtime tests; the admin credential is never mounted into either runtime
container.

Teardown reads the original service token from its mounted token path into
memory, proves it authenticates before revocation, revokes the recorded token
ID, and proves that same token now receives `401`; only then does it unlink the
token and finish entity/policy/service cleanup. Missing token bytes while state
claims `TOKEN_CREATED`/`READY`, a token that cannot authenticate before revoke,
or a token that still authenticates afterward is cleanup failure and release
`NO-GO`.

Fault-injection tests terminate bootstrap at every boundary immediately after
an API success and before the corresponding journal rename, then run
`--recover`. Exact readback must prove no service account, token, created
policy, synthetic entity/tag, changed boot policy, or local token/state file
survives. The same matrix kills after each `PREPARED` and `APPLIED` write and
proves recovery is idempotent on a second run.

The admin credential is not a checked-in token. `create-datahub-secrets.mjs`
creates 256-bit random GMS signing key, salt, and system-client secret files
under ignored `work/secrets` with directory mode `0700` and file mode `0600`.
The no-network `datahub-auth-init` service runs the pinned GMS image as root,
resolves the image's `datahub` UID/GID, copies signing key/salt to the GMS-only
tmpfs and system-client secret to the separate bootstrap-shared tmpfs as fixed
`0400` files, verifies owner/mode/length, and exits. GMS runs the reviewed
wrapper, reads those files, exports
`DATAHUB_TOKEN_SERVICE_SIGNING_KEY`, `DATAHUB_TOKEN_SERVICE_SALT`, and
`DATAHUB_SYSTEM_CLIENT_SECRET`, then `exec`s
`/datahub/datahub-gms/scripts/start.sh`.

For each setup or teardown invocation, `bootstrap.mjs` reads the system-client
secret from a file and POSTs the fixed body `{"userId":"datahub"}` to
`/auth/generateSessionTokenForUser` with the v1.6.0 system `Basic
__datahub_system:<secret>` header. It keeps the returned root session token only
in process memory, uses it for the bounded GraphQL/ingest sequence, and discards
it on exit. It refuses redirects, any non-loopback URL in `--bootstrap-test`
mode, and any actor other than root `datahub`. The persistent state contains no
system secret or root token.

- [ ] **Step 5: Run real DataHub read and denial tests**

Run:

```bash
node --test scripts/test/check-security-shell.test.mjs
node scripts/check-security-shell.mjs \
  security/security-shell-transitions.v1.json
node scripts/test-datahub-bootstrap.mjs
```

`test-datahub-bootstrap.mjs` is the executable ordering contract. Using
`execFile` without a shell, it creates the three secrets, renders
`infra/datahub/bootstrap.compose.yaml` with `--bootstrap-test`, runs
`datahub-auth-init`, starts the pinned prerequisites/GMS with a bounded health
deadline, runs `bootstrap.mjs --setup` with the test-only token/state outputs
under ignored `work/`, then invokes exactly:

```bash
pnpm exec vitest run tests/integration/datahub-bootstrap.test.ts tests/integration/datahub-token-privileges.test.ts --maxWorkers=1
```

Its `finally` path runs authenticated teardown while GMS is still reachable,
brings the bootstrap stack down with volumes, and destroys all host secret
files. Teardown failure makes the command fail. Expected: exact dataset/schema
reads succeed; unauthenticated requests, all mutation/admin/token/policy
operations, and other-resource reads fail; no secret remains afterward.
Task 3 separately repeats setup through the Compose `datahub-bootstrap` service
and tmpfs token/state volumes before any release acceptance claim is allowed.

- [ ] **Step 6: Review and commit**

Run the `code-review` skill, then:

```bash
git add -- <every path in the current Delivery row Files cell, and no other path>
git commit -m "<that row's exact Commit cell>"
```

### Task 3: Minimal runtime images and hard network separation

**Delivery:** This section is an umbrella only. Deliver these sequential,
non-stacked PR tasks; merge each into `main` before starting the next.

| Task | Branch | Files (exhaustive) | Commit |
|---|---|---|---|
| 3A — runtime closures | `build/minimal-runtime-images` | Create `apps/context-mcp/Dockerfile`, `apps/context-mcp/Dockerfile.dockerignore`, `apps/query-executor/Dockerfile`, `apps/query-executor/Dockerfile.dockerignore`, `scripts/verify-policy-artifacts.mjs`, `scripts/test/verify-policy-artifacts.test.mjs`; modify `security/security-transitions.v1.json` | `build(runtime): create separate minimal images` |
| 3B — verified artifacts/images | `build/verified-runtime-artifacts` | Create `scripts/fetch-policy-artifacts.mjs`, `scripts/build-runtime-images.mjs`; modify `scripts/verify-policy-artifacts.mjs`, `scripts/test/verify-policy-artifacts.test.mjs`, `scripts/lock-images.mjs`, `scripts/test/lock-images.test.mjs`, `infra/images.lock.json`, `security/security-transitions.v1.json` | `build(runtime): bind verified image artifacts` |
| 3C — secrets and topology | `feat/runtime-secret-topology` | Create `infra/compose.template.yaml`, `infra/compose.locked.yaml`, `scripts/create-demo-secrets.mjs`, `scripts/provision-runtime-secrets.mjs`; modify `security/security-transitions.v1.json` | `feat(runtime): isolate secret and network topology` |
| 3D — lifecycle assertions | `test/runtime-isolation-lifecycle` | Create `scripts/start-demo-stack.mjs`, `scripts/teardown-demo-stack.mjs`, `scripts/assert-runtime-isolation.mjs`, `tests/integration/runtime-isolation.test.ts`; modify `security/security-transitions.v1.json` | `test(runtime): prove isolated lifecycle` |

3A runs offline verifier, Dockerfile static/content, and default-deny-context
tests only. 3B runs online artifact provenance, two-checkout reproducible build,
raw-manifest equality, and local-lock tests. 3C runs secret/provisioner tests
and locked Compose rendering/config inspection without claiming a live
lifecycle. 3D alone starts from clean state, runs runtime isolation, and tears
down in `finally`.

Every slice runs focused tests, `pnpm check`, and `code-review`; 3D must start
and tear down from clean state. If a slice exceeds 220 authored lines after
excluding only `LLM-CONTRACT` comments, split it again; generated locks count.

**Files:**
- Create: `apps/context-mcp/Dockerfile`
- Create: `apps/context-mcp/Dockerfile.dockerignore`
- Create: `apps/query-executor/Dockerfile`
- Create: `apps/query-executor/Dockerfile.dockerignore`
- Create: `infra/compose.template.yaml`
- Create: `infra/compose.locked.yaml`
- Modify: `infra/images.lock.json`
- Create: `scripts/create-demo-secrets.mjs`
- Create: `scripts/provision-runtime-secrets.mjs`
- Create: `scripts/fetch-policy-artifacts.mjs`
- Create: `scripts/verify-policy-artifacts.mjs`
- Create: `scripts/test/verify-policy-artifacts.test.mjs`
- Create: `scripts/build-runtime-images.mjs`
- Modify: `scripts/lock-images.mjs`
- Modify: `scripts/test/lock-images.test.mjs`
- Create: `scripts/start-demo-stack.mjs`
- Create: `scripts/teardown-demo-stack.mjs`
- Create: `scripts/assert-runtime-isolation.mjs`
- Create: `tests/integration/runtime-isolation.test.ts`
- Modify: `security/security-transitions.v1.json`

**Interfaces:**
- Consumes: image lock, built application artifacts, four protected policy
  artifacts, separate GMS/admin/executor secrets, reviewed PostgreSQL init
  files, and the dedicated socket volume.
- Produces: tag-free release Compose and machine-verifiable runtime isolation.

- [ ] **Step 1: Build the two separate dependency closures**

Context image stages:

```dockerfile
FROM ghcr.io/astral-sh/uv:0.11.32@sha256:df4cae8f3a96d175e2e5f992e597550000edbe78fdc2594d5cd8de1a217f504c AS uv-bin
FROM python:3.12.11-slim-bookworm@sha256:519591d6871b7bc437060736b9f7456b8731f1499a57e22e6c285135ae657bf7 AS python-child
COPY --from=uv-bin /uv /uvx /bin/
WORKDIR /opt/datahub-mcp
COPY apps/context-mcp/datahub-child/pyproject.toml apps/context-mcp/datahub-child/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable

FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS context-build
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/context-mcp apps/context-mcp
RUN corepack pnpm install --frozen-lockfile
RUN corepack pnpm --filter @okf-datahub/context-mcp build
RUN corepack pnpm --filter @okf-datahub/context-mcp \
    deploy --prod --legacy /out/context-mcp

FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS node-closure
RUN set -eu; \
    mkdir -p /node-closure/bin /node-closure/lib; \
    cp /usr/local/bin/node /node-closure/bin/node; \
    ldd /usr/local/bin/node \
      | sed -nE 's/.*=> (\/[^ ]+).*/\1/p; s/^[[:space:]]*(\/[^ ]+).*/\1/p' \
      | sort -u \
      | grep -Ev '/(ld-linux|libc\.so|libm\.so|libpthread\.so|librt\.so|libdl\.so)' \
      | while IFS= read -r library; do cp "$library" /node-closure/lib/; done

FROM python-child AS context-runtime
COPY --from=node-closure /node-closure /opt/node
COPY --from=context-build /out/context-mcp /app
ENV PATH=/opt/node/bin:/opt/datahub-mcp/.venv/bin:/usr/local/bin:/usr/bin:/bin
ENV LD_LIBRARY_PATH=/opt/node/lib
ENV PYTHONNOUSERSITE=1 PYTHONDONTWRITEBYTECODE=1
ENV HOME=/tmp/context-home XDG_CACHE_HOME=/tmp/context-cache
RUN groupadd --gid 10001 context-mcp \
    && groupadd --gid 10003 okf-socket \
    && useradd --uid 10001 --gid 10001 --groups 10003 \
       --no-create-home --shell /usr/sbin/nologin context-mcp \
    && rm -f /bin/uv /bin/uvx /usr/local/bin/pip /usr/local/bin/pip3 \
       /usr/local/bin/pip3.12 \
    && rm -rf /usr/local/lib/python3.12/site-packages/pip \
       /usr/local/lib/python3.12/site-packages/pip-* \
       /var/lib/apt/lists/*
USER 10001:10001
RUN ! ldd /opt/node/bin/node | grep -q 'not found' \
    && node --version \
    && mcp-server-datahub --version
ENTRYPOINT ["/opt/node/bin/node", "/app/dist/main.js"]
```

Executor build and final stages:

```dockerfile
FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS executor-build
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/query-executor apps/query-executor
RUN corepack pnpm install --frozen-lockfile
RUN corepack pnpm --filter @okf-datahub/query-executor build
RUN corepack pnpm --filter @okf-datahub/query-executor \
    deploy --prod --legacy /out/query-executor

FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS policy-verify
WORKDIR /verify
COPY scripts/verify-policy-artifacts.mjs ./verify-policy-artifacts.mjs
COPY dist/policy ./policy
RUN node ./verify-policy-artifacts.mjs --offline ./policy

FROM gcr.io/distroless/nodejs24-debian12:nonroot@sha256:14d42e2511532589a7c7e01a753667a74fcc96266e137e8125006b87b0c32d0a
WORKDIR /app
COPY --from=executor-build --chown=10002:10002 /out/query-executor /app
COPY --from=policy-verify --chown=10002:10002 --chmod=0444 /verify/policy/policy-ir.v1.json /opt/okf-policy/policy-ir.v1.json
COPY --from=policy-verify --chown=10002:10002 --chmod=0444 /verify/policy/resource-bindings.v1.json /opt/okf-policy/resource-bindings.v1.json
COPY --from=policy-verify --chown=10002:10002 --chmod=0444 /verify/policy/review-attestation.v1.json /opt/okf-policy/review-attestation.v1.json
COPY --from=policy-verify --chown=10002:10002 --chmod=0444 /verify/policy/policy-manifest.v1.json /opt/okf-policy/policy-manifest.v1.json
USER 10002:10002
ENTRYPOINT ["/nodejs/bin/node", "/app/dist/main.js"]
```

The context final stage starts from the pinned Python image, puts Node under
`/opt/node`, and copies only Node's non-glibc shared libraries into the private
`/opt/node/lib`; it never overwrites the Python image's loader, libc, libm, or
system paths. Final-stage `ldd` must contain no `not found`, and a build-time
smoke under UID 10001 proves both runtimes and the pinned child binary start.
The runtime real-child test must additionally complete MCP
initialize/initialized and `tools/list`; an import/version-only smoke is not
release evidence.

Each Dockerfile has a Dockerfile-specific default-deny ignore file (`**` first)
that re-includes only its exact root manifests, contracts, app directory and,
for executor, the verifier plus four policy filenames. It never admits `.git`,
`work`, secrets, host `node_modules`, `.venv`, coverage, or arbitrary `dist`.
The executor build context must contain exactly the four provenance-verified
policy JSON files; a fifth file fails both before and inside `docker build`.
The offline build-stage verifier is standalone, validates the four closed
schemas and all digest cross-links without network access, and the final stage
copies four explicit filenames rather than a glob. BuildKit creates
`/opt/okf-policy` as a traversable directory and installs each artifact owned by
UID/GID 10002 with mode `0444`, matching the executor's startup `fstat`
contract. The executor final stage contains no context app, Python,
MCP/YAML/compiler packages, source OKF Markdown, shell, or package manager.

- [ ] **Step 2: Build, publish, and lock the local runtime images**

```bash
node scripts/build-runtime-images.mjs \
  --repository-id "$POLICY_REPOSITORY_ID" \
  --run-id "$POLICY_WORKFLOW_RUN_ID" \
  --artifact-id "$POLICY_ARTIFACT_ID" \
  --reviewed-commit "$POLICY_REVIEWED_COMMIT" \
  --platform linux/amd64
node scripts/lock-images.mjs --verify-local --platform linux/amd64
node scripts/lock-images.mjs --verify-complete
```

`fetch-policy-artifacts.mjs` requires that `dist/policy` does not exist, resolves
the one successful non-expired `policy-artifacts` Actions artifact by immutable
artifact database ID inside the immutable run database ID, and requires the API
repository ID, workflow path, reviewed `head_sha`, explicit
`POLICY_ARTIFACT_ID`, and explicit `POLICY_REVIEWED_COMMIT` to match. It also requires
that reviewed commit to be an ancestor of current `HEAD`; current `HEAD`
equality is neither expected nor an authority. It downloads without a shell
into a new `0700` temporary directory, rejects zip traversal, symlinks, duplicate
entries and all names except the four fixed JSON files, then atomically renames
the directory. A branch name, latest run, artifact-name search, or caller-owned
URL is never an authority.

`verify-policy-artifacts.mjs` requires a newly created directory containing
exactly the four expected filenames, validates each closed schema and digest
cross-link, and invokes `gh attestation verify` without a shell for every file
against the immutable repository ID recorded by the protected workflow. Any
extra file, missing attestation, repository mismatch, or subject-digest mismatch
stops before `docker build`.

After online verification it is the sole constructor of a frozen,
non-deserializable `VerifiedPolicyReceipt` capability containing exactly
`repositoryId`, `workflowRunId`, `artifactId`, `reviewedCommit`, and the four
raw file SHA-256 digests in fixed filename order. The constructor token remains
module-private. Only the receipt module can emit its canonical bytes for the
BuildKit secret and digest; a caller cannot provide or deserialize it.
`build-runtime-images.mjs` is the single
release pipeline: it imports fetch, verification, build, and lock functions and
keeps the capability in the same process. The standalone fetch/verify CLIs are
test/diagnostic paths and cannot produce a releasable image lock.

The same script's `--offline` mode is the Docker build-stage check: it performs
only exact filename/schema/canonical-byte/cross-link verification and refuses
all network/provenance options. Immediately before creating each build context,
the builder rehashes the four files against the in-memory receipt. It supplies
the receipt through a BuildKit secret mount unavailable to later layers; the
offline stage rehashes all four files against it before any `COPY`. Immediately
after each build, the locker safely extracts the four exact final-image paths
from the OCI layers, rehashes them, and records the receipt digest and four raw
digests next to the image child digest. Any replacement between online
verification, build-context consumption, or locking is `NO-GO`. Release image
locking is permitted only after the online attestation pass in this same
orchestrated process; a standalone Docker build or caller-authored receipt is
never accepted as a release artifact.

`build-runtime-images.mjs` accepts only the literal `linux/amd64`. It
idempotently starts the pinned registry bound to loopback, polls `/v2/` with a
bounded deadline, creates a docker-container builder with exact driver image
`moby/buildkit@sha256:63db51c9b30208a7c2b1c40392c7ebb9ce2f85ba238a18a85420f8f5ea2d4684`,
and verifies the builder reports BuildKit v0.31.2/source revision before any
build. The builder and dedicated registry share one private Docker network;
both candidate builds use BuildKit `--push` directly to that registry, never
`--load` or a host-daemon push. The exact image exporter is
`type=image,push=true,rewrite-timestamp=true`, with `SOURCE_DATE_EPOCH` derived
from the reviewed commit. For each image it performs two no-cache builds for
the exact platform from two clean checkouts whose filesystem mtimes are
deliberately different, normalizes OCI metadata, fetches both raw
platform-manifest byte strings from
the registry, requires their SHA-256 and bytes, config, and ordered layers to
match, and promotes the common child digest with pinned
`docker buildx imagetools create --prefer-index=false`. It then re-fetches the
final raw manifest and requires byte/digest equality. The unpinned host daemon
only hosts the isolated builder/registry containers and cannot provide build
or push content. Time-varying SBOM/provenance is generated
outside the image manifest by the release gate.

Only then may `lock-images.mjs --local` atomically add the two release
digests under the lock's single `linux/amd64` platform. Its default
`--verify-local` mode is non-writing and requires the exact declared platform
descriptor with no host-default, manifest list, or extra platform. The
private registry remains running through acceptance because release Compose
pulls both images by repository plus digest.

- [ ] **Step 3: Define the exact trust topology**

```yaml
networks:
  metadata_api_net: {internal: true}
  datahub_backend_net: {internal: true}
  database_net: {internal: true}
volumes:
  executor_socket:
    driver: local
    driver_opts:
      type: tmpfs
      device: tmpfs
      o: "size=1m,uid=10002,gid=10003,mode=0710"
  datahub_token:
    driver: local
    driver_opts:
      type: tmpfs
      device: tmpfs
      o: "size=64k,uid=0,gid=10001,mode=0710"
  bootstrap_state:
    driver: local
    driver_opts:
      type: tmpfs
      device: tmpfs
      o: "size=64k,mode=0700"
  datahub_signing:
    driver: local
    driver_opts:
      type: tmpfs
      device: tmpfs
      o: "size=64k,mode=0711"
  datahub_system_client:
    driver: local
    driver_opts:
      type: tmpfs
      device: tmpfs
      o: "size=64k,uid=0,gid=10004,mode=0710"
  postgres_admin_secret:
    driver: local
    driver_opts:
      type: tmpfs
      device: tmpfs
      o: "size=64k,uid=0,gid=999,mode=0710"
  postgres_executor_seed:
    driver: local
    driver_opts:
      type: tmpfs
      device: tmpfs
      o: "size=64k,uid=0,gid=999,mode=0710"
  executor_dsn:
    driver: local
    driver_opts:
      type: tmpfs
      device: tmpfs
      o: "size=64k,uid=0,gid=10002,mode=0710"
```

`context-mcp` joins only `metadata_api_net`, runs UID 10001 with supplementary
GID 10003 via `group_add: ["10003"]`, and mounts only its token and socket.
GMS alone joins both `metadata_api_net` and `datahub_backend_net`; MySQL,
Elasticsearch, Kafka, Schema Registry, ZooKeeper, and upgrade join only the
backend network. Bootstrap joins only the API network. Context and bootstrap
must fail TCP connection attempts to every backend service.

Context is a `stdio` profile service,
spawned interactively by the MCP host or test harness; it is not a background
daemon. `query-executor` joins only `database_net`, runs UID 10002, and mounts
only its DSN, policy artifacts, and socket; it also receives supplementary GID
10003 so it can set the created socket to group 10003 and mode `0660`. They use `read_only: true`,
`cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `pids_limit: 64`,
explicit CPU/memory/FD limits, and different writable tmpfs mounts.

`scripts/create-demo-secrets.mjs` uses independent
`randomBytes(32).toString("base64url")` values, creates `work/secrets` with mode
`0700`, and atomically writes GMS signing key/salt/system-client secret,
PostgreSQL admin password, executor password, and the derived fixed-host
executor DSN with host mode `0600`.
A one-shot Node `secret-init` service has no network and owns only the three
database-side targets: `postgres_admin_secret`, `postgres_executor_seed`, and
`executor_dsn`. It uses the pinned Node image with exact command
`node /opt/okf-bootstrap/provision-runtime-secrets.mjs`, a read-only script
mount/root filesystem, `user: "0:0"`, and only the three target plus fixed
read-only source mounts. It copies fixed
filenames, sets consuming owners/mode `0400`, verifies bytes/owners/modes, and
exits.

Separately, `datahub-auth-init` uses the pinned GMS image and invokes the Task 2
`infra/datahub/provision-auth-secrets.sh` through `/bin/sh`; it resolves the
actual `datahub` UID/GID, writes signing key/salt only to `datahub_signing` and
the system-client secret as `root:10004` mode `0440` to
`datahub_system_client`, verifies mode/owner, and exits. GMS mounts both
read-only and receives supplementary bootstrap-secret GID 10004 solely to read
that file.

The one-shot `datahub-bootstrap` service uses the pinned Node image, exact
`node /opt/okf-bootstrap/bootstrap.mjs --setup|--teardown` command, `user:
"0:0"`, supplementary GID 10004, read-only root, and only `CHOWN`/`FOWNER`
capabilities. It mounts the bootstrap script, proposal and policy fixtures
read-only, `datahub_system_client` read-only, and token/state tmpfs outputs; it
never mounts signing key/salt or any database secret. Setup chowns the reader
token to `10001:10001` mode `0400`; teardown unlinks it. The token-volume root
stays `0:10001` mode `0710`: bootstrap can create/unlink as directory owner,
while context can only traverse it through GID 10001 and mounts it read-only.
`secret-init` and `datahub-auth-init` have no network; bootstrap joins only
`metadata_api_net` and must fail routes to
the DataHub backend and database networks. All three are removed before runtime
assertions. All three start from `cap_drop: [ALL]` and add only `CHOWN` and
`FOWNER`; no service receives `DAC_OVERRIDE`. Runtime inspection verifies the
exact effective capability masks, directory/file owner and mode, and the
context token mount's read-only flag before accepting startup.

PostgreSQL starts with only `postgres_admin_secret`, no published port, the
reviewed table fixture, and
`-c shared_preload_libraries=pg_stat_statements -c compute_query_id=on -c
pg_stat_statements.track=all`. A one-shot `db-role-init` joins `database_net`,
mounts admin plus `postgres_executor_seed`, applies the reviewed role/schema/
ACL scripts through `psql`, installs `pg_stat_statements` in the fixed
`okf_monitor` schema, revokes its schema/view/functions from `PUBLIC` and the
executor, and exits. The executor mounts only `executor_dsn`; a test-only admin
harness mounts only the admin secret. Context mounts none of these. Host sources
and tmpfs targets are ignored/scanned for accidental
image copying and destroyed by the explicit teardown after the database volume.

Stage 2 already owns the executor schema-attestation implementation and drift
matrix for exactly `pg_stat_statements@1.12` in `okf_monitor`, the reviewed
owner/preload settings, and the exact admin-only ACL projection. Task 3 changes
only provisioning to satisfy that merged contract and runs its existing tests;
it must not modify executor attestation source or relax a check as an
integration exception. Startup rejects a missing/different/relocated or extra
extension, executor or `PUBLIC` access, changed owner, or missing preload.

- [ ] **Step 4: Write runtime assertions before rendering**

```js
assert.deepEqual(networksOf("context-mcp"), ["metadata_api_net"]);
assert.deepEqual(
  networksOf("datahub-gms"),
  ["datahub_backend_net", "metadata_api_net"],
);
assert.deepEqual(networksOf("query-executor"), ["database_net"]);
assert.equal(uidOf("context-mcp"), 10001);
assert.equal(uidOf("query-executor"), 10002);
assert.deepEqual(supplementaryGroupsOf("context-mcp"), [10003]);
assert.deepEqual(supplementaryGroupsOf("query-executor"), [10003]);
assert.deepEqual(capabilitiesOf("context-mcp"), []);
assert.deepEqual(capabilitiesOf("query-executor"), []);
assert.equal(rootFilesystemReadOnly("query-executor"), true);
assert.equal(canConnect("context-mcp", "postgres", 5432), false);
assert.equal(canConnect("query-executor", "datahub-gms", 8080), false);
for (const [host, port] of [
  ["mysql", 3306], ["elasticsearch", 9200], ["broker", 29092],
  ["schema-registry", 8081], ["zookeeper", 2181],
]) {
  assert.equal(canConnect("context-mcp", host, port), false);
}
```

- [ ] **Step 5: Render, start, and inspect the locked topology**

Run:

```bash
node scripts/create-demo-secrets.mjs
node scripts/render-compose.mjs
docker compose -f infra/compose.locked.yaml config
node scripts/start-demo-stack.mjs
node scripts/assert-runtime-isolation.mjs --spawn-context
```

`start-demo-stack.mjs` is the sole release startup path. With `execFile` and
bounded monotonic deadlines it:

1. requires the complete image lock, four online-verified policy artifacts,
   generated secrets, and a rendered release Compose with no host ports;
2. runs `secret-init` and `datahub-auth-init`, requires successful one-shot
   completion, and removes both containers;
3. starts PostgreSQL plus the DataHub backend, upgrade and authenticated GMS,
   requiring each declared health/completion condition;
4. runs `db-role-init`, then the `datahub-bootstrap --setup` profile service on
   `metadata_api_net`; setup writes the reader token to `datahub_token` and
   token-free teardown state to `bootstrap_state`;
5. removes both privileged one-shot containers, starts `query-executor`, and
   requires executor readiness before returning.

No step continues after a failed condition. The startup test first proves an
unauthenticated GMS GraphQL request is `401`, then obtains the bounded root
session through the file-backed system secret; it never disables
authentication.

`--spawn-context` runs
`docker compose --profile stdio run --rm -T context-mcp`, keeps stdin open while
it inspects the live container, completes MCP `initialize`,
`notifications/initialized`, and `tools/list` against the real pinned Python
child, then sends EOF and requires a clean exit.
Expected: PASS; the complete lock has every public and local source, every
service uses an image digest, and runtime route/mount inspection matches the
design.

- [ ] **Step 6: Scan image contents for authority leaks**

Assert:

- context image: no DB DSN, policy YAML/compiler, mutation tool config, or executor secret;
- executor image: no DataHub token/client/MCP SDK/YAML/compiler/shell/package
  manager and no executable projection/filter/compiler branch or generated SQL
  token for `email`; the reviewed binding and schema may identify the denied
  column so denial can be enforced and audited;
- neither image: bootstrap token, source-control credentials, writable root, or cross-network route.

- [ ] **Step 7: Review and merge each mandatory slice**

For each row, run its focused tests plus `pnpm check`, invoke `code-review`,
commit only the row's exclusive files with its named commit, merge, update
`main`, and continue. Do not combine or stack the slices; only 3D may claim the
end-to-end runtime-isolation result.

### Task 4: Real-service acceptance and adversarial suite

**Delivery:** This section is an umbrella only.

| Task | Branch | Files (exhaustive) | Commit |
|---|---|---|---|
| 4A — acceptance and privilege harness | `test/governed-query-acceptance` | Create `tests/integration/harness.ts`, `tests/integration/tsconfig.json`, `tests/integration/demo-acceptance.test.ts`, `tests/integration/database-privileges.test.ts`, `scripts/run-real-service-suite.mjs`; modify `security/security-transitions.v1.json` | `test: prove governed query acceptance` |
| 4B — adversarial clean lifecycle | `test/governed-query-adversarial-e2e` | Create `tests/integration/adversarial-inputs.test.ts`, `tests/integration/failure-modes.test.ts`, `tests/integration/log-canaries.test.ts`; modify `scripts/run-real-service-suite.mjs`, `security/security-transitions.v1.json` | `test: prove governed query fail-closed behavior` |

4A's runner supports only the ordered acceptance/privilege group and owns the
clean outer lifecycle. 4B extends the closed test-ID list with the adversarial
group and reruns both groups. Direct Vitest invocation against a pre-existing
stack is forbidden in both rows.

**Files:**
- Create: `tests/integration/harness.ts`
- Create: `tests/integration/tsconfig.json`
- Create: `tests/integration/demo-acceptance.test.ts`
- Create: `tests/integration/adversarial-inputs.test.ts`
- Create: `tests/integration/failure-modes.test.ts`
- Create: `tests/integration/log-canaries.test.ts`
- Create: `tests/integration/database-privileges.test.ts`
- Create: `scripts/run-real-service-suite.mjs`
- Modify: `security/security-transitions.v1.json`

**Interfaces:**
- Consumes: locked real DataHub Core, real pinned DataHub MCP child, real PostgreSQL 18.4, context MCP, and executor.
- Produces: evidence for the five demo acceptance claims and the full attack matrix.

`tests/integration/tsconfig.json` extends the strict root config, sets
`noEmit: true` and `composite: false`, and includes every
`tests/integration/**/*.ts` file plus imported test helpers. It is a mandatory
gate because Vitest transpilation alone is not type checking.

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": false,
    "noEmit": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["./**/*.ts", "../../scripts/test-support/**/*.ts"]
}
```

- [ ] **Step 1: Instrument application-query counting**

Require the Task 3 database attestation to prove
`shared_preload_libraries=pg_stat_statements`, extension version `1.12`, schema
`okf_monitor`, and admin-only ACLs before any counter test. Through the
test-only admin harness, reset statistics before each case and require an empty
baseline; then count only the exact normalized fixed application `SELECT` with
`application_name = 'okf-query-executor'`. The executor role cannot resolve,
query, or execute extension objects. Exclude startup attestation, lock primer,
and catalog projections using reviewed exact query IDs; inability to reset,
read, or uniquely identify the application statement is release `NO-GO`.

- [ ] **Step 2: Implement the five acceptance tests**

```ts
it("characterizes the exact minimum DataHub MCP privilege", async () => {
  expect(await getGrantedPrivilegesAsRoot(READER_ACTOR, DATASET_URN))
    .toStrictEqual({
      metadataPrivileges: ["VIEW_ENTITY_PAGE"],
      platformPrivileges: [],
    });
  await expect(callPinnedDataHubChild("get_entities", DATASET_URN))
    .resolves.toMatchObject({ urn: DATASET_URN });
  await expect(callPinnedDataHubChild("list_schema_fields", DATASET_URN))
    .resolves.toMatchObject({ urn: DATASET_URN, totalFields: 5 });

  await withReaderPolicyInactive(async () => {
    await expect(callPinnedDataHubChild("get_entities", DATASET_URN))
      .rejects.toMatchObject({ category: "AUTHORIZATION_OR_NOT_FOUND" });
    await expect(callPinnedDataHubChild("list_schema_fields", DATASET_URN))
      .rejects.toMatchObject({ category: "AUTHORIZATION_OR_NOT_FOUND" });
  });

  expect(await getGrantedPrivilegesAsRoot(READER_ACTOR, DATASET_URN))
    .toStrictEqual({
      metadataPrivileges: ["VIEW_ENTITY_PAGE"],
      platformPrivileges: [],
    });
});

it("allows customer_id plus total exactly once", async () => {
  const result = await callQuery(safeQuery());
  expect(result.structuredContent).toMatchObject({
    status: "COMPLETED", decision: "ALLOW",
    reasonCodes: ["POLICY_ALLOWED"],
  });
  expect(await applicationQueryCount()).toBe(1);
});

it.each([emailProjection(), emailProhibitedFilter()])(
  "denies email with zero application queries",
  async (input) => {
    const result = await callQuery(input);
    expect(result.structuredContent).toMatchObject({
      status: "REJECTED", decision: "DENY",
      reasonCodes: ["FIELD_USE_DENIED"],
    });
    expect(await applicationQueryCount()).toBe(0);
  },
);
```

`withReaderPolicyInactive` is a root-only test-harness transition with
`try/finally` restoration and exact policy readback before the next test. A
failure to restore aborts and tears down the suite. No application container
receives the root token. Also prove context came through real DataHub MCP, the
executor role cannot read email or `*`, and DataHub
outage/policy tamper/schema drift/injection fail closed.

- [ ] **Step 3: Add the complete adversarial matrix**

Cases include multi-statement tokens, comments, NUL, confusables, duplicates, oversized strings, malformed decimal/date/enum/opaque IDs, unknown versions/keys, expired/tampered artifacts, URN substitution, prompt-injection prose, table/view/partition/foreign-table substitution, row-string attacks, DataHub timeout/malformed/oversized output, queue exhaustion, cancellation, lock/statement timeout, rollback failure, and second/trailing frames.

- [ ] **Step 4: Add secret/result leakage canaries**

Scan MCP stdout, container stderr, Docker logs, audit output, CI artifacts, and test failure output for:

```text
DATAHUB_TOKEN_CANARY
POSTGRES_DSN_CANARY
alice@example.invalid
SELECT "customer_id"
ZodError
ECONNREFUSED
/opt/okf-policy
```

Only fixed operation IDs, field IDs/operators, digests, reason codes, counts, and duration buckets may appear in audit.

- [ ] **Step 5: Run the complete real-service suite**

Run:

```bash
node scripts/run-real-service-suite.mjs \
  --repository-id "$POLICY_REPOSITORY_ID" \
  --run-id "$POLICY_WORKFLOW_RUN_ID" \
  --artifact-id "$POLICY_ARTIFACT_ID" \
  --reviewed-commit "$POLICY_REVIEWED_COMMIT"
```

`run-real-service-suite.mjs` is Task 4's bounded outer owner. From a clean
worktree and clean Docker state it requires the immutable repository/run/
artifact/commit tuple, fetches and verifies the immutable four-file
policy tuple, rebuilds the fixed `linux/amd64` application images and verifies
them against the non-writing committed lock, creates ephemeral secrets, renders
and starts the stack, type-checks `tests/integration/tsconfig.json`, and invokes
the two ordered Vitest groups above without a shell. Its `finally` always calls
the idempotent Task 3 teardown, even on setup, assertion, timeout, signal, or
test failure. A test cannot consume a stack, registry, secret, or artifact left
by another task.

Expected: PASS with no fallback, partial result, leaked canary, or authorization bypass.

- [ ] **Step 6: Review and commit**

Run the `code-review` skill, then:

```bash
git add -- <every path in the current Delivery row Files cell, and no other path>
git commit -m "<that row's exact Commit cell>"
```

### Task 5: Mandatory supply-chain and release gate

**Delivery:** This section is an umbrella only.

| Task | Branch | Files (exhaustive) | Commit |
|---|---|---|---|
| 5A — scanner and secret gates | `build/release-source-gates` | Create `scripts/check-runtime-dependencies.mjs`, `scripts/check-secrets.mjs`; modify `flake.nix`, `flake.lock`, `scripts/check-toolchain.mjs`, `security/security-transitions.v1.json` | `build: pin release source gates` |
| 5B — SBOM and vulnerability gate | `build/release-vulnerability-gate` | Create `scripts/generate-sboms.mjs`, `scripts/lock-grype-db.mjs`, `infra/grype-db.lock.json`, `infra/vulnerability-policy.v1.json`; modify `security/security-transitions.v1.json` | `build: make vulnerability evidence blocking` |
| 5C — exact license inventory | `build/release-license-gate` | Create `scripts/check-licenses.mjs`, `scripts/test/check-licenses.test.mjs`, `infra/licenses-policy.v1.json`, `infra/licenses-inventory.v1.json`; modify `security/security-transitions.v1.json` | `build: bind exact license obligations` |
| 5D — aggregate release decision | `build/mandatory-release-gate` | Create `scripts/release-check.mjs`, `scripts/run-clean-release.mjs`, `.github/workflows/release-gate.yml`, `docs/security-claims.md`; modify `security/security-transitions.v1.json` | `build: make every security gate release blocking` |

5A runs exact scanner-version, runtime-dependency, and secret tests. 5B runs
locked/offline SBOM and vulnerability fixtures. 5C runs the exact license
inventory suite against the then-current locked images. 5D runs the workflow
static gate and complete clean `GO`/`NO-GO` aggregator; no earlier row claims a
release decision.

**Files:**
- Modify: `flake.nix`
- Modify: `flake.lock`
- Modify: `scripts/check-toolchain.mjs`
- Create: `scripts/release-check.mjs`
- Create: `scripts/check-runtime-dependencies.mjs`
- Create: `scripts/check-secrets.mjs`
- Create: `scripts/generate-sboms.mjs`
- Create: `scripts/lock-grype-db.mjs`
- Create: `scripts/check-licenses.mjs`
- Create: `scripts/test/check-licenses.test.mjs`
- Create: `infra/licenses-policy.v1.json`
- Create: `infra/licenses-inventory.v1.json`
- Create: `infra/grype-db.lock.json`
- Create: `infra/vulnerability-policy.v1.json`
- Create: `scripts/run-clean-release.mjs`
- Create: `.github/workflows/release-gate.yml`
- Create: `docs/security-claims.md`
- Modify: `security/security-transitions.v1.json`

**Interfaces:**
- Consumes: source, locks, images, SBOMs, tests, formal proofs, and running containers.
- Produces: one `GO`/`NO-GO` JSON record containing only gate IDs and fixed statuses.

- [ ] **Step 1: Add locked scanners to the Nix shell**

Add `syft`, `grype`, and `gitleaks` from the already locked exact Nix input.
ShellCheck, Docker CLI 29.6.2, Compose 5.1.4, and Buildx 0.31.1 already come
from the Foundation toolchain and are rechecked rather than redefined.
`flake.lock` is the scanner version authority; CI prints versions but does not
install from the network.
`scripts/check-toolchain.mjs` is extended to require exact
`syft 1.44.0`, `grype 0.112.0`, and `gitleaks 8.30.1`; substring or
major-only checks are forbidden.

- [ ] **Step 2: Implement the exact gate list**

```js
const REQUIRED_GATES = Object.freeze([
  "toolchain", "format", "lint", "types", "unit", "contract", "property",
  "privilege", "integration", "adversarial", "lean", "transition-parity",
  "tcb-source", "shell-tcb", "sql-tcb", "lock-drift", "sbom", "vulnerability-db",
  "vulnerability", "license",
  "secret", "image-digest", "runtime-isolation", "mcp-snapshot",
]);
```

`release-check.mjs` uses `execFile` without a shell, stops only after recording every independent gate, emits `NO-GO` if any gate fails, and never prints command stderr containing secrets.
The `tcb-source` gate executes
`node scripts/check-tcb.mjs --manifest security/security-transitions.v1.json
--roots contracts,compiler,context,executor,integration`; a
missing root or skipped root is `NO-GO`.
The `shell-tcb` gate executes
`node scripts/check-security-shell.mjs
security/security-shell-transitions.v1.json` followed by pinned ShellCheck;
any of the three registered shells missing from the registry is `NO-GO`.
The `sql-tcb` gate executes
`node scripts/check-security-sql.mjs
security/security-sql-transitions.v1.json`; any registered PostgreSQL
migration missing, changed, or uncontracted is `NO-GO`.

- [ ] **Step 3: Generate and scan separate SBOMs**

`generate-sboms.mjs` reads the rendered locked Compose, deduplicates every
`image@sha256` reference (applications and third-party infrastructure), and
invokes Syft without a shell into one bounded file per digest. It fails if the
Compose set and SBOM set differ. Run:

```bash
node scripts/generate-sboms.mjs
node scripts/lock-grype-db.mjs --verify --max-age-days 7
node scripts/check-licenses.mjs \
  infra/licenses-policy.v1.json \
  infra/licenses-inventory.v1.json \
  work/sbom
gitleaks detect --no-banner --redact
```

`lock-grype-db.mjs --update` downloads the official Grype database archive
without a shell, validates the pinned Grype schema/version, and writes a closed
lock containing source URI, archive SHA-256, database metadata SHA-256, build
timestamp, schema version, and exact Grype version. Normal release is
non-writing and offline: it requires those bytes from a verified cache,
`GRYPE_DB_AUTO_UPDATE=false`, and a database age no greater than seven days.
Missing/stale/mismatched DB bytes or update/network failure is `NO-GO`; a scan
never silently consults the mutable latest database.

`release-check` invokes the locked Grype binary and locked offline DB with
`--fail-on high` for every generated SBOM. The
executor dependency check rejects MCP, DataHub, YAML, compiler, Python, and
shell packages; the context check rejects PostgreSQL clients and policy
compiler artifacts.

`infra/vulnerability-policy.v1.json` is a strict reviewed exception set keyed
by exact image digest, purl, package version, vulnerability ID, scanner
namespace, fixed/unfixed state, reason, reviewer, review timestamp, and expiry.
Wildcards and vendor/image-wide exceptions are forbidden. A HIGH/CRITICAL with
a fixed version may not be excepted: the image is upgraded/removed or release
is `NO-GO`. A short-lived exception is permitted only for a primary-source
confirmed unfixed finding and expires within 14 days. Before this task merges,
the complete locked SBOM set is scanned with the locked DB; every finding is
upgraded away or receives one exact reviewed entry. Any new, changed, expired,
or absent finding/entry and every unused stale exception is `NO-GO`.

`infra/licenses-policy.v1.json` is a closed reviewed SPDX policy. Its direct
allowlist covers only the named permissive expressions `0BSD`, `Apache-2.0`,
`BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `MIT`, `MPL-2.0`, `PSF-2.0`,
`PostgreSQL`, `Unicode-3.0`, and `Zlib`. It does not pretend that the Debian,
PostgreSQL, MySQL, DataHub, or Confluent image closures contain only those
licenses.

`infra/licenses-inventory.v1.json` is therefore a mandatory reviewed closure
generated from the exact locked SBOM set in this task and then committed. Each
non-direct-allowlist component is keyed by exact image digest, purl, version,
and SPDX expression and records `distribution` (`REDISTRIBUTED_APP_IMAGE` or
`UPSTREAM_PULL_ONLY`), a fixed obligation ID, primary-source evidence URI plus
digest, reviewer, review timestamp, and expiry. GPL/LGPL and other expected OS
components may pass only through such exact entries and recorded obligations;
there are no image-, vendor-, or license-wide wildcards.

Missing components, `NOASSERTION`, unknown/malformed expressions, unresolved
dual licensing, expired entries, changed image/purl/version/license, missing
primary-source evidence, or an SBOM/inventory set mismatch are `NO-GO`.
`NOASSERTION` must be resolved to a reviewed SPDX expression from primary
source; it cannot be waived. Tests cover compound expressions, expected
GPL/LGPL inventory entries, unknowns, expired/mismatched records, wildcard
attempts, and SBOM omission. This is a reproducible inventory/obligation gate,
not legal advice.

- [ ] **Step 4: Write scoped security claims**

`docs/security-claims.md` states the exact trust roots and residual risks: protected build/repository compromise, PostgreSQL administrator/host root, semantically wrong approved policy, DataHub staleness, denial of service, dependency defects, local-user compromise, and previously trusted image rollback. It explicitly says the demo is not production security.

- [ ] **Step 5: Run the aggregate gate**

Run:

```bash
nix develop -c node scripts/run-clean-release.mjs \
  --repository-id "$POLICY_REPOSITORY_ID" \
  --run-id "$POLICY_WORKFLOW_RUN_ID" \
  --artifact-id "$POLICY_ARTIFACT_ID" \
  --reviewed-commit "$POLICY_REVIEWED_COMMIT" \
  --platform linux/amd64 \
  --no-demo
```

Expected: one JSON object with `"decision":"GO"` and every required gate `"PASS"`. A missing scanner, skipped test, warning-only result, or image tag is `NO-GO`.

`run-clean-release.mjs` is the outer try/finally owner. It requires explicit
repository ID, workflow run ID, artifact ID, and reviewed policy commit; the release
platform is the compiled literal `linux/amd64` and is not caller-selectable;
then installs/builds the clean workspace, syncs the pinned Python child,
fetches/verifies policy artifacts, reproducibly prepares/locks images, creates
secrets, renders/starts the release stack, and invokes `release-check.mjs`.
Its `finally` always invokes `teardown-demo-stack.mjs`, even after partial
startup or a failed gate. CI has an independent `if: always()` call to the same
idempotent teardown as defense in depth.

- [ ] **Step 6: Review and commit**

Run the `code-review` skill, then:

```bash
git add -- <every path in the current Delivery row Files cell, and no other path>
git commit -m "<that row's exact Commit cell>"
```

### Task 6: Deterministic hackathon demo and evidence bundle

**Delivery:** This section is an umbrella only.

| Task | Branch | Files (exhaustive) | Commit |
|---|---|---|---|
| 6A — deterministic demo runner | `feat/hackathon-demo-runner` | Create `scripts/demo.mjs`, `scripts/test/demo.test.mjs`; modify `scripts/run-clean-release.mjs`, `security/security-transitions.v1.json` | `feat(demo): run fixed governed-query evidence` |
| 6B — reviewed presentation bundle | `docs/hackathon-demo-runbook` | Create `docs/demo-runbook.md`, `outputs/demo-evidence/README.md` | `docs: add the governed query demo runbook` |

6A runs redaction/repeatability tests and the demo inside the already-clean
release owner. 6B runs link, command, six-minute timeline, and evidence-schema
checks only; it does not change executable behavior.

**Files:**
- Create: `docs/demo-runbook.md`
- Create: `scripts/demo.mjs`
- Create: `scripts/test/demo.test.mjs`
- Create: `outputs/demo-evidence/README.md`
- Modify: `scripts/run-clean-release.mjs`
- Modify: `security/security-transitions.v1.json`

**Interfaces:**
- Consumes: an immutable protected-artifact tuple and clean Docker state.
- Produces: a six-minute deterministic demo with machine-readable sanitized evidence.

- [ ] **Step 1: Define the exact demo sequence**

```text
00:00–00:45  show two-container authority separation and pinned sources
00:45–01:30  get_entity_context through real DataHub MCP
01:30–02:30  allow customer_id + total; show application query count = 1
02:30–03:30  deny email projection and value-free filter; query count = 0
03:30–04:15  prove DB role cannot read email or SELECT *
04:15–05:30  DataHub outage, policy tamper, schema drift, injection fail closed
05:30–06:00  show digests, review evidence, residual-risk boundary, GO gates
```

- [ ] **Step 2: Implement fixed demo actions**

`scripts/demo.mjs` invokes only the two public tools with checked-in request fixtures, queries only sanitized test counters, emits no secret/result value, and stops if the release record is not `GO`.
Task 6 adds the closed `--demo` mode to `run-clean-release.mjs`: after a `GO`
record and while the same stack remains live, it invokes `demo.mjs --verify`
before entering the existing `finally`.

```js
const scenarios = Object.freeze([
  "context", "safe-query", "email-projection-denied",
  "email-filter-denied", "db-acl-denied", "failure-matrix",
]);
```

- [ ] **Step 3: Test redaction and repeatability**

Run:

```bash
node --test scripts/test/demo.test.mjs
nix develop -c node scripts/run-clean-release.mjs \
  --repository-id "$POLICY_REPOSITORY_ID" \
  --run-id "$POLICY_WORKFLOW_RUN_ID" \
  --artifact-id "$POLICY_ARTIFACT_ID" \
  --reviewed-commit "$POLICY_REVIEWED_COMMIT" \
  --platform linux/amd64 \
  --demo
```

Expected: two clean runs produce identical scenario/status/digest evidence; operation IDs and durations are normalized out of the comparison, and no canary appears.

- [ ] **Step 4: Write the evidence index**

The output README links each claim to its primary-source pin, test ID, release-gate ID, and sanitized evidence file. It does not contain raw DataHub/DB responses, tokens, logs, or email values.

- [ ] **Step 5: Review and commit**

Run the `code-review` skill, then:

```bash
git add -- <every path in the current Delivery row Files cell, and no other path>
git commit -m "<that row's exact Commit cell>"
```

## Plan Completion Gate

From a clean clone, clean Docker state, and the immutable protected-artifact
tuple:

```bash
nix develop -c node scripts/run-clean-release.mjs \
  --repository-id "$POLICY_REPOSITORY_ID" \
  --run-id "$POLICY_WORKFLOW_RUN_ID" \
  --artifact-id "$POLICY_ARTIFACT_ID" \
  --reviewed-commit "$POLICY_REVIEWED_COMMIT" \
  --platform linux/amd64 \
  --demo
```

The script's fixed order is: frozen install and TypeScript build; pinned `uv
sync`; policy fetch/online verification; two-build image reproducibility and
local lock verification; secret creation; release Compose render; bounded
startup/provision/bootstrap; release gate; demo; Compose bootstrap teardown;
`down -v`; registry removal; host-secret and fetched-artifact destruction.

Expected: release `GO`, deterministic sanitized demo evidence, a sanitized GO
record linked by the evidence index, and complete disposal of the synthetic
stack. `teardown-demo-stack.mjs` is the sole teardown path: while GMS and
token/state/system-secret volumes are reachable it runs the Compose
`datahub-bootstrap --teardown` service, proves revocation, restores policies and
deletes synthetic entities/service, then destroys Compose volumes, registry,
host secrets, and downloaded artifacts. Any cleanup failure changes the final
decision to `NO-GO`.
