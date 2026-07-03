---
name: risk-and-rollback
description: Identify a change's real risks, prefer reversible designs, and plan concrete rollback — including data and compatibility, not just git revert.
---

# Risk and rollback planning

Every plan needs an answer to two questions: *what could go wrong?* and *if it does, how do we get back?* "Revert the commit" is only a rollback plan when the change is stateless; most bad outcomes involve state the revert does not undo.

## Identifying real risks

Rate each risk by likelihood × impact, and only carry forward the ones that would actually change what you do. For each, ask:

- **Detection**: how would we even notice? A risk with no detection signal (no test, no error surface, no visible symptom) is the most dangerous kind — add the signal or the test as part of the plan.
- **Mechanism**: name the concrete failure ("migration locks the table under load", "old cache entries fail the new parser"), not a category ("performance risk").
- **Trigger conditions**: what has to be true for it to fire — scale, timing, specific data shapes, a particular platform?

Common under-weighted risks: data written in a new format before a rollback; behavior depended on via Hyrum's law (error text, ordering, timing); the deploy/upgrade window where old and new code coexist; third-party API drift; a "quick" dependency upgrade pulling transitive changes.

## Prefer reversible designs (two-way doors)

When choosing between designs of similar merit, pick the one that is cheaper to undo:

- **Expand → migrate → contract** for schemas and contracts: add the new column/field/endpoint alongside the old, move readers then writers, remove the old only after the new is proven. Each phase is separately shippable and separately revertible.
- Keep destructive steps (dropping columns, deleting files, removing endpoints) in their own final step that can be deferred indefinitely.
- Gate risky behavior behind a switch (config, flag, env var) when the project has one — with the OLD behavior as the default until proven, and a plan to delete the switch after.
- Make new writes backward-readable: version fields in serialized data, tolerant readers (ignore unknown fields), defaults for missing ones.

## The rollback plan itself

Write it as concretely as a forward step:

- **Code**: which commits/changes to revert, and whether they revert cleanly (a refactor landed alongside makes reverts dirty — another reason to separate them).
- **Data**: what has been written in the new format by the time of rollback, and what happens to it — reverse migration (write and test it now, not during the incident), tolerant old code, or an explicit "new rows are lost and that is acceptable" statement.
- **State outside the repo**: caches to purge, queues to drain, config/flags to flip back, generated artifacts to rebuild.
- **Verification**: the command or check that proves the system is healthy again after rollback.

If a step is genuinely irreversible (destructive migration, external announcement, deleting user data), mark it as a **point of no return** in the plan, put it as late as possible, and require explicit confirmation that everything before it is verified.

## In reviews

Ask of any risky diff: what is the detection signal, what is the undo path, and is anything written to persistent state that the undo path doesn't cover? If the author can't answer in a sentence each, the change isn't ready.

## Further reading

- Martin Fowler, martinfowler.com — "ParallelChange" (expand/contract), "BranchByAbstraction", "Feature Toggles"
- *Site Reliability Engineering* (Google), ch. "Release Engineering" — rollback readiness
