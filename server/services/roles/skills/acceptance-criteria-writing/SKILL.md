---
name: acceptance-criteria-writing
description: Write acceptance criteria that decide pass/fail unambiguously — Given/When/Then done right, measurable thresholds, and coverage of failure and empty states.
---

# Writing acceptance criteria

Acceptance criteria are the contract that lets someone else — a developer, a tester, an executing agent — decide "done" without asking you. Every criterion must be decidable: a specific system state, a specific action, an observable result. If two readers could disagree on pass/fail, rewrite it.

## Given / When / Then, done right

```
Given a project with no configured providers
When the user opens the composer
Then the provider dropdown shows only "Configure providers…" and the send button is disabled
```

- **Given** — concrete preconditions: which data exists, which state the system is in. "Given a logged-in user" is weak; "Given a user with 3 saved flows, one of them running" is decidable.
- **When** — ONE action. Two actions in a When means two scenarios.
- **Then** — an observable outcome: what appears, what is stored, what is returned, what is emitted. Never internal implementation ("the cache is updated") unless that state IS externally observable — write what the user or a consumer can verify.
- One scenario per behavior. Resist the mega-scenario that chains a whole workflow; chained scenarios fail as one blob and pinpoint nothing.

## Cover the paths that get skipped

Happy-path-only criteria are the top source of "done but broken". For each story, systematically add scenarios for:
- **Failure**: the external call errors, the input is invalid, the operation is cancelled midway. What must the user see, and what must the system state be afterwards?
- **Empty / first-run**: nothing exists yet. What renders, and what invites the first action?
- **Repeat / idempotency**: the same action performed twice; the user retrying after a failure.
- **Boundaries**: limits stated in the story (max lengths, counts, sizes) each get an at-limit and past-limit scenario.
- **Permissions/visibility** where applicable: who must NOT be able to do or see this.

## Quantify or delete qualifiers

"Fast", "responsive", "user-friendly", "robust", "secure" are not criteria. Convert each to a measurement ("search results render within 300ms for 1,000 items", "the app remains usable while a run is in progress") or move it to a design-guidance note. The same for scope words: "supports large repos" → "repo scan completes in under 10s for 50k files".

## Criteria are not test scripts, and not designs

- Keep them at behavior level: "the thread list shows the newest thread first", not "click the third button and inspect the DOM". Implementation-level detail belongs to tests; criteria must survive a UI redesign that preserves behavior.
- Don't smuggle solutions: "results are cached in SQLite" is a design decision — the criterion is "reopening the view within a session does not re-fetch".

## Definition of done vs acceptance criteria

Acceptance criteria are per-story. Cross-cutting expectations (tests written, typecheck clean, docs updated, no console errors) belong in a shared definition of done — reference it once instead of repeating it in every story, and never let boilerplate crowd out story-specific criteria.

## Review checklist

- Could a tester with no context mark each criterion pass/fail? Could an automated test be written from it directly?
- Failure, empty, and repeat scenarios present (or explicitly deferred)?
- Every qualifier quantified? Every Then observable?
- Nothing that dictates implementation?
- Non-goals stated so "done" has a boundary?

## Further reading

- Gojko Adzic, *Specification by Example* — criteria as living documentation
- Dan North, "Introducing BDD" — dannorth.net/introducing-bdd
- Cucumber docs on Gherkin best practices — cucumber.io/docs/bdd
