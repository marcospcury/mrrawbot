---
name: blast-radius-analysis
description: Enumerate everything a change can reach — callers, data, contracts, UI, build, docs — and classify each as edit, must-update, or verify-only.
---

# Blast radius analysis

Before committing to a change (or approving one), enumerate everything it can reach. "Small, contained change" is a conclusion you may only state AFTER the enumeration — never before. Most regressions come from a touchpoint nobody listed.

## The method

For every surface you intend to modify (function, type, schema, config key, endpoint, event, file format):

1. **Find all consumers.** Search the repository for the symbol name, its aliases, its serialized/string forms (JSON keys, event names, route paths, env var names, SQL column names), and its re-exports. Use several searches — a rename of `getUser` must also catch `"user:get"`, `USER_ENDPOINT`, and reflection/dynamic access. Record the searches you ran so a reviewer can re-run them.
2. **Classify each hit:**
   - **Direct edit** — a file the change modifies on purpose.
   - **Must update** — breaks (compile, runtime, or silently wrong) unless changed: callers, implementations of a changed interface, tests, fixtures, type definitions, mocks, docs with code samples, generated code sources.
   - **Verify only** — should keep working unchanged; name the specific check that proves it (which test, which command, which manual step).
3. **Anything unclassified is a finding**, not an omission you may skip.

## Surfaces beyond code

Walk this list explicitly — these are where "safe" changes explode:

- **Persisted data**: DB schema and every existing row written by old code; serialized blobs, caches, queued jobs written in the old format. New code must read old data (backward compatibility); if the change ever rolls back, old code may read new data (forward compatibility). Plan migration AND rollback.
- **Contracts**: HTTP/IPC/RPC endpoints and their clients; event and message shapes; CLI flags and output that scripts parse; webhook payloads; public library exports (semver).
- **Cross-version drift**: during deploy or after a partial rollback, old and new code run against the same data/peers. Is every intermediate combination safe?
- **UI**: every screen rendering the changed data — including loading, error, empty, and stale-cache states; keyboard shortcuts; deep links.
- **Async & background**: scheduled jobs, queue consumers, retry handlers that touch the changed entity.
- **Build & packaging**: bundler/packaging file lists, path assumptions (dev layout vs packaged layout), platform-specific steps, CI workflows.
- **Configuration & environment**: defaults, env var overrides, settings migrations, feature flags gating the area.
- **Docs & instructions**: READMEs, agent/contributor instruction files, code comments stating the old behavior, onboarding scripts.

## Behavioral blast radius (Hyrum's law)

Consumers depend on observable behavior, not just signatures: error messages someone greps for, list ordering, timing, ID formats, default values, field order in output. When changing behavior inside an unchanged signature, ask what could observe the difference — and check whether anything does.

## Output format

Present the result as a table — surface, impact class, and what covers it (step number, test name, or command):

| Surface | Impact | Covered by |
|---|---|---|
| `resolveRolePrompt()` callers (engine.ts, tests) | must update | step 3, step 7 |
| packaged app file layout | verify only | `npm run app` smoke check |

Every **must update** row must map to a concrete step; every **verify only** row to a concrete check. A row with an empty "covered by" cell means the plan or review is not done.
