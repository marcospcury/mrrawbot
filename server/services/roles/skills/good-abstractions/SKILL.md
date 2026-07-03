---
name: good-abstractions
description: Design deep, information-hiding abstractions and know when NOT to abstract — Ousterhout, Parnas, rule of three, Hyrum's law.
---

# Designing good abstractions

An abstraction earns its keep when its interface is much simpler than the implementation it hides. Judge every module, class, and function you introduce by that ratio.

## Deep modules beat shallow ones (Ousterhout)

From John Ousterhout's *A Philosophy of Software Design*:
- A **deep** module offers a small, simple interface over substantial functionality (e.g. a file system's open/read/write/close hiding caches, drivers, and journaling).
- A **shallow** module's interface is nearly as complex as what it hides — a wrapper that renames parameters, a "manager" that forwards calls. Shallow modules add indirection without absorbing complexity; inline them.
- "Classitis": many tiny classes each simple in isolation, but whose interactions carry all the complexity. Complexity pushed into the seams is worse than complexity inside one module.

## Information hiding (Parnas)

Decompose around design decisions likely to change — data formats, storage choices, protocols, algorithms — and hide each inside one module (D.L. Parnas, "On the Criteria to Be Used in Decomposing Systems into Modules", 1972).
- Leakage smell: a change to one decision (say, a storage format) forces edits in several modules. That decision was never actually hidden.
- Interfaces should be shaped by what callers *need*, not by what the implementation *does*. Design from the caller's side: write the ideal calling code first, then build the module that supports it.

## When to abstract: the rule of three

- First occurrence: write it inline.
- Second: copy it and note the duplication — two points define no trend, and a premature "unification" often forces unrelated cases through one API.
- Third: now the shape of the commonality is visible; extract it, designed around the real variation you observed.
- Sandi Metz: "duplication is far cheaper than the wrong abstraction." When an existing abstraction accretes flags and conditionals to serve divergent callers, inline it back and re-split along the true seam.

## Interfaces are forever (Hyrum's law)

"With a sufficient number of users, all observable behaviors of your system will be depended on by somebody." Every exposed detail — ordering, timing, error text, incidental fields — becomes a contract.
- Expose the minimum. Return the narrowest type that serves the caller; keep helpers private until a second consumer proves the need.
- Make illegal states unrepresentable: prefer types/shapes that cannot express invalid combinations over runtime checks that reject them.

## General-purpose vs special-purpose

Ousterhout's guidance: make a module *somewhat* general-purpose — its interface general enough to serve plausible near-term uses, its implementation only what today needs. If the general form is no harder to build and simpler to describe, choose it; if generality adds parameters, modes, or config for hypothetical callers, drop it (YAGNI).

## Checklist before introducing an abstraction

- Is the interface meaningfully simpler than the implementation it hides? (If not: inline it.)
- Which change does it protect callers from? Name the decision being hidden.
- Are there ≥2 real usages, or one usage and near-certain knowledge of the second?
- Could a caller misuse it by relying on incidental behavior? Tighten what's observable.
- Does its name state what it provides, in domain language — not `helper`, `util`, `manager`, `data`?

## Further reading

- John Ousterhout, *A Philosophy of Software Design* — deep modules, information leakage, "define errors out of existence"
- D.L. Parnas, "On the Criteria to Be Used in Decomposing Systems into Modules" (1972)
- Sandi Metz, "The Wrong Abstraction" — sandimetz.com
- Martin Fowler, martinfowler.com — "Yagni", "BeckDesignRules"
- Hyrum Wright — hyrumslaw.com; *Software Engineering at Google*, ch. 1
