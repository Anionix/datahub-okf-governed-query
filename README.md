# DataHub + OKF Governed Query

A security-focused MCP adapter that combines read-only DataHub metadata
evidence with a reviewed OKF-derived policy IR before executing a closed,
typed query against synthetic PostgreSQL data.

## Status

The architecture and implementation slices are specified. Implementation starts
with the reproducible TypeScript and Nix foundation.

## Core boundary

```text
MCP caller
  -> Context MCP
      -> pinned DataHub MCP (read-only evidence)
      -> private Unix socket
          -> Query Executor
              -> reviewed Policy IR
              -> live PostgreSQL schema and role verification
              -> fixed typed SQL
  <- validated structured result
```

- DataHub is evidence, not the authorization authority.
- Runtime authorization is deterministic; an LLM does not decide `ALLOW`.
- The executor never accepts arbitrary SQL.
- The MVP does not write decisions or query results back to DataHub.
- The demo uses one synthetic dataset and fails closed on ambiguity or drift.

Start with the
[design specification](docs/superpowers/specs/2026-07-28-datahub-okf-governed-query-design.md)
and the
[implementation plan index](outputs/datahub-okf-governed-query-plan-index.md).

