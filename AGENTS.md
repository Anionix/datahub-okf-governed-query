# Repository instructions

## GitHub workflow

- These rules apply to this owner-controlled original repository.
- Do not use stacked pull requests. Create a branch from current `main`.
- Keep one task per pull request and target roughly 200 changed lines.
- Only `LLM-CONTRACT` comment lines are excluded from that target.
- Resolve or mark outdated every merged review thread. Convert confirmed bugs
  into labelled GitHub issues.

## Engineering requirements

- Put an `LLM-CONTRACT` state-transition comment on every code authority or
  orchestration boundary named by the implementation plans.
- Cite the primary source behind security-sensitive behavior and version pins.
- Prefer type-safe closed representations and mechanize mathematical
  invariants with Lean where the plans require it.
- Use Biome for JavaScript, TypeScript, JSON, CSS, and GraphQL formatting.
- Use language-specific diagnostics and error tooling. TypeScript work must
  pass strict typechecking; Rust work must pass Clippy and use typed errors.
- Keep `flake.nix` and `flake.lock` in the repository and treat lock drift as a
  reviewed change.
- Optimize for low cognitive load: explicit names, bounded interfaces,
  deterministic commands, and a clear repository map.
- Run the `code-review` skill before opening every pull request.
- Use independent subagents when they improve speed without overlapping file
  ownership. Prefer GPT-5.6 Luna when it is available.

## Agent skills

### Issue tracker

Issues and specifications are tracked in this repository's GitHub Issues. See
`docs/agents/issue-tracker.md`.

### Triage labels

Use the five canonical Matt Pocock triage labels. See
`docs/agents/triage-labels.md`.

### Domain docs

Use the single-context domain-document layout. See `docs/agents/domain.md`.

