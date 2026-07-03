---
name: test-adequacy-review
description: Judge whether a change's tests actually prove the behavior — coverage of the claim, edge and error paths, refactor-resistance, and honest failure detection.
---

# Test adequacy review

The question is never "are there tests?" but "if this change were subtly wrong, would a test fail?" Review tests as claims of evidence: each behavior the change promises needs a test that would catch its absence.

## Map claims to tests

1. List what the change claims to do (from the task, the diff, the PR description): new behaviors, fixed bugs, preserved behaviors under refactor.
2. For each claim, find the test that fails if the claim is false. No test → gap. A test that passes even with the fix reverted → decoration, not evidence.
3. For a bug fix, insist on the regression test that reproduces the original bug — mentally (or actually) revert the fix and check the test would go red.

## Would the tests catch a wrong implementation?

- **Assertion strength**: does the test assert the actual outcome, or just "no exception thrown" / "result is not null" / "mock was called"? Weak assertions pass for many wrong implementations.
- **Mutation thinking**: pick 2–3 plausible mistakes (off-by-one, inverted condition, wrong field, missed await) and check a test would fail for each. This is manual mutation testing — cheap and revealing.
- **Over-mocked tests**: if every collaborator is a mock, the test proves the code calls what it calls, not that the system works. Interaction verification is only right when the interaction IS the contract.
- **Tautologies**: fixtures or helpers that compute the expected value with the same logic as the production code prove nothing.

## Coverage of the paths that break

Happy path + these, wherever the change makes them reachable:
- Error paths: the external call fails, the input is malformed, the file is missing. Untested error handling is usually wrong.
- Edges: empty, one, many; boundary values; duplicates; cancellation mid-way; concurrent/repeated invocation where relevant.
- State variants: first-run vs existing data; old-format persisted data still readable after the change.
- Line/branch coverage is a gap-finder, not a target: uncovered changed lines are findings; 100% coverage with weak assertions is still inadequate.

## Will the tests age well?

- **Refactor-resistance**: tests assert observable behavior (returns, persisted state, emitted events), not private internals, call order that doesn't matter, or exact snapshots of huge structures (broad snapshots assert everything, therefore nothing — they break on noise and get blindly re-recorded).
- **Determinism**: no real clocks, sleeps, randomness, network, shared global state, or order dependence. A flaky test is worse than none — it trains people to re-run failures.
- **Readability**: name states the behavior; Arrange-Act-Assert visible; a failure message that points at the cause. If a reviewer can't tell what a failing run would mean, the test needs work.
- **Right level**: pure logic tested as unit tests, boundaries as integration tests; flag logic that's only exercised through slow E2E paths — it should be extracted and unit-tested.

## Reporting

For each gap: the untested claim, the concrete wrong-implementation that would slip through, and the specific test to add ("a test that runs the migration on a DB created by the previous schema and asserts row X survives"). Rank gaps like any finding: an untested data-loss path is a blocker; a missing nice-to-have edge case is minor. Also flag test smells (flakiness, over-mocking, tautology) as maintainability findings — they silently rot the suite's value.

## Further reading

- Martin Fowler, martinfowler.com — "TestCoverage", "Eradicating Non-Determinism in Tests", "Mocks Aren't Stubs"
- Vladimir Khorikov, *Unit Testing: Principles, Practices, and Patterns* — the four pillars (regression protection, refactor resistance, feedback speed, maintainability)
- mutation testing background: pitest.org/quickstart/mutators
