---
name: unit-testing-practices
description: Write unit tests that catch regressions without freezing implementation — AAA, FIRST, test pyramid, classical vs mockist doubles.
---

# Unit testing practices

A good test suite lets you refactor fearlessly: it fails when behavior breaks and stays green when only implementation changes. Optimize for that, not for coverage numbers.

## Test behavior, not implementation

- Name each test after the behavior it proves: `returns empty list when repo has no branches`, not `test_getBranches_2`.
- Assert on observable outcomes — return values, persisted state, emitted events, thrown errors — never on private fields, call order that doesn't matter, or exact internal call counts.
- If a pure refactor (same behavior, new structure) breaks a test, the test was wrong. Fix the test's coupling, don't fossilize the old structure.

## Structure: Arrange–Act–Assert

One behavior per test. Arrange the world, perform ONE action, assert the outcome. Multiple asserts are fine when they describe one outcome; multiple *actions* mean the test should split. Keep the cause→effect visible inside the test body — a reader should not need to open six helpers to know what's being tested (prefer explicit setup or well-named builders over deep fixture magic).

## FIRST properties

- **Fast** — milliseconds; slow suites stop being run.
- **Isolated** — no dependence on other tests, execution order, shared mutable state, or leftover files; each test builds and cleans its own world (temp dirs, fresh DB/schema).
- **Repeatable** — same result on every machine and every run. Control the clock, randomness, timezone, and network; a test that "usually passes" is a defect.
- **Self-validating** — pass/fail without human inspection of output.
- **Timely** — written with (or before) the code, while the behavior's edge cases are fresh.

## What to double, what to keep real (Fowler, "Mocks Aren't Stubs")

- Default to the **classical** style: use real collaborators for pure in-process logic; reserve test doubles for true boundaries — network, filesystem, clock, randomness, databases, external processes.
- A **stub** feeds the test canned data; a **mock** verifies an interaction. Verify interactions only when the interaction IS the behavior (e.g. "sends exactly one notification"); otherwise assert state.
- Over-mocking smell: a test that mocks everything the unit touches proves only that the code calls what it calls — it will pass while the real system is broken, and fail on every refactor.
- Don't mock what you don't own: wrap the third-party API behind your own thin interface and double that.

## The pyramid

Many fast unit tests on pure logic; fewer integration tests where components meet the real boundary (real DB file, real HTTP server on a port, real filesystem); very few end-to-end tests for the critical paths. Push each check down to the cheapest layer that can catch it. An "ice cream cone" (mostly E2E) is slow, flaky, and pins blame poorly.

## Edge cases and regressions

- Every fixed bug gets a regression test that fails on the pre-fix code — write it first, watch it fail, then fix.
- Cover: empty/null/zero inputs, boundaries and off-by-one, duplicates, error paths (not just the happy path), cancellation/timeout behavior where relevant.
- For logic with many input combinations, prefer table-driven tests over copy-pasted test bodies.

## Checklist

- Does each test name state a behavior a product owner would recognize?
- Would these tests survive a correct refactor? Fail on a real regression?
- Are doubles confined to true external boundaries?
- Are clock, randomness, and filesystem controlled?
- Is there a failing-first regression test for the bug being fixed?

## Further reading

- Martin Fowler, martinfowler.com — "Mocks Aren't Stubs", "UnitTest", "TestPyramid", "Eradicating Non-Determinism in Tests"
- Kent Beck, *Test-Driven Development: By Example*
- Gerard Meszaros, *xUnit Test Patterns* — the vocabulary of doubles and fixtures
- Vladimir Khorikov, *Unit Testing: Principles, Practices, and Patterns* — resistance-to-refactoring framing
