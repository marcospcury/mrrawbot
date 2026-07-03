---
name: code-review-calibration
description: Calibrate review findings — verify before reporting, rank by real severity, separate blocking defects from preferences, keep signal high.
---

# Code review calibration

A review's value is its signal-to-noise ratio. One verified real bug outweighs twenty style nits; one false positive teaches the author to ignore you. Calibrate ruthlessly.

## Verify before you report

- Read enough context to know a finding is real: the callers, the guard clauses upstream, the type constraints, the test that already covers it. Most "possible null" and "missing validation" findings die on a two-minute read of the call path.
- Trace the failure scenario concretely: what input or state, through which path, produces which wrong outcome? If you cannot write that sentence, you don't have a finding — you have a suspicion. Either investigate until it's concrete or drop it.
- Run things when you can: the test suite, the typecheck, the reproduction. A demonstrated failure is unarguable.
- Check your assumption against the codebase's conventions before flagging a "violation" — the pattern you dislike may be the project's deliberate, documented choice.

## Severity ladder

Rank every finding; lead with the worst. Don't inflate — a mislabeled nit erodes trust in your criticals.

1. **Blocker** — corrupts data, breaks the build, security hole, crashes a mainline path, violates a stated project constraint.
2. **Major** — wrong behavior on realistic inputs, race condition, regression of an existing feature, missing error handling on a path that will fail in practice, breaking API change without migration.
3. **Minor** — edge case unlikely in practice, confusing naming that will mislead maintainers, missing test for important new behavior, performance issue on a non-hot path.
4. **Nit / preference** — style, phrasing, alternative approach of equal merit. Mark them as nits explicitly, never let them block, and omit them entirely when the review already carries substantive findings.

## What to actually look for (in priority order)

1. Correctness: does the code do what the change intends, for edge inputs and error paths, not just the happy case?
2. Blast radius: what else consumes the changed surface — callers, persisted data, contracts — and was it updated? (A diff review that only reads the diff misses this; read the surroundings.)
3. Security and data safety at trust boundaries.
4. Tests: do they prove the new behavior and pin the fixed bug, and would they survive a refactor?
5. Maintainability: will the next reader misunderstand this? Is complexity proportionate to the problem?

## Reporting

- For each finding: location (file:line), the concrete failure scenario, severity, and — when you're confident — the suggested fix. Distinguish "this is broken" from "consider this" grammatically; don't hedge real defects and don't assert preferences as facts.
- Scope discipline: review the change that was made, not the change you would have made. An alternative design is worth one advisory note, not a rewrite demand — unless the chosen design actually fails a requirement.
- Say what's good when it's load-bearing ("the expand/contract migration makes this safely revertible") — it tells the author what to keep.
- End with an explicit verdict when the process asks for one (approve / approve-with-nits / request changes), consistent with your own severity ranking: majors and blockers mean request changes; nits alone never do.

## Further reading

- Google's Engineering Practices: "How to do a code review" — google.github.io/eng-practices/review/reviewer/
- *Software Engineering at Google*, ch. 9 (Code Review) — review as knowledge transfer, speed matters
