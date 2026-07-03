---
name: refactoring-discipline
description: Refactor safely — behavior-preserving micro-steps, characterization tests for legacy code, and separating refactors from behavior changes.
---

# Refactoring discipline

Refactoring (Fowler): changing the internal structure of code **without changing its observable behavior**, in small steps, each verified. If behavior changes, it isn't a refactor — it's a change, and it needs its own tests and its own review.

## The two hats (Kent Beck)

Wear one hat at a time: either you are *adding behavior* (tests change, structure stays put) or you are *refactoring* (structure changes, tests stay green and untouched). Never both in one step — a diff that mixes them can't be reviewed or bisected. If a feature needs restructuring first, do "preparatory refactoring": land the behavior-preserving reshaping, verify, then land the behavior change. ("Make the change easy, then make the easy change.")

## Small verified steps

- Work in steps so small that a mistake is obvious: rename, extract function, inline, move, split loop, replace temp with query. After each step, run the narrowest check that proves behavior held (targeted tests, typecheck, build).
- Prefer mechanical, tool-assisted transformations (rename symbol, extract) over hand re-typing.
- If a step goes red and the fix isn't obvious within a couple of minutes, revert to the last green state and take a smaller step. Never debug your way forward through a broken refactor.
- Commit (or checkpoint) at green states so any regression bisects to one small transformation.

## Legacy code: characterize before you touch (Feathers)

Code without tests is "legacy code" (Michael Feathers) — before restructuring it:
1. Write **characterization tests** that pin down what the code *actually does now* (including behavior that looks wrong — record it, flag it, don't silently "fix" it; a fix is a behavior change to do separately).
2. If the code can't be tested as-is, open a minimal **seam** first: extract the untestable dependency behind a parameter or interface, changing as little as possible.
3. Only then refactor, keeping the characterization tests green throughout.

## Scope control

- Refactor only as far as the task needs. A bug fix does not license reorganizing the module; note further opportunities in your final report instead of doing them.
- Don't "improve" adjacent code, comments, or formatting in the same change — every extra touched line dilutes review and enlarges blast radius.
- Preserve public APIs, wire formats, persisted data shapes, and user-visible behavior exactly, unless changing them IS the task. Watch for accidental observable changes: error messages, ordering, timing, serialization key order that something might depend on (Hyrum's law).

## Smells worth acting on (Fowler's catalog, abridged)

Duplicated code (rule of three), long function doing several things, feature envy (a function mostly using another module's data — move it), shotgun surgery (one logical change requiring edits in many places — consolidate), divergent change (one module edited for unrelated reasons — split), data clumps (same parameter group recurring — introduce a type), primitive obsession, speculative generality (unused flexibility — remove it).

## Checklist

- Am I wearing exactly one hat in this diff?
- Is every step independently verifiable, and verified?
- For untested code: characterization tests written first?
- Did observable behavior — including errors, ordering, formats — stay identical?
- Did I stop at the task's boundary?

## Further reading

- Martin Fowler, *Refactoring: Improving the Design of Existing Code* (2nd ed.) and refactoring.com/catalog
- Michael Feathers, *Working Effectively with Legacy Code* — seams, characterization tests
- Kent Beck, *Tidy First?* — sequencing small structural changes
