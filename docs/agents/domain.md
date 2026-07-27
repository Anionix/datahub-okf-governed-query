# Domain docs

This repository uses a single-context domain-document layout.

Before changing domain behavior, read:

- `CONTEXT.md`, when present;
- relevant ADRs under `docs/adr/`;
- the governed-query design specification.

Use the glossary's exact vocabulary in code, tests, issues, and review
findings. If a proposed change conflicts with an ADR, surface the conflict
instead of silently overriding it.

`CONTEXT.md` and ADRs are created only when a domain term or durable decision
needs them; their current absence is not an error.

