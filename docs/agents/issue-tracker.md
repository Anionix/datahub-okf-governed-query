# Issue tracker: GitHub

Issues, specifications, and implementation tickets live in this repository's
GitHub Issues.

## Conventions

- Use `gh issue create` to publish an issue.
- Use `gh issue view <number> --comments` to read the complete current issue.
- Use `gh issue edit` to change labels or assignees.
- Use `gh issue close <number> --comment "..."` only after its acceptance
  criteria are verified.
- Apply `ready-for-agent` only to fully specified, blocker-free work.
- Represent blocking edges with GitHub issue dependencies. If the dependency
  API is unavailable, include a `Blocked by: #<number>` line in the body.

Pull requests are not a triage request surface. GitHub Issues are the canonical
source for incoming work and implementation tickets.

