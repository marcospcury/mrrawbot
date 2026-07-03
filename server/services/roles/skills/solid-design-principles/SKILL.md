---
name: solid-design-principles
description: Apply the SOLID principles pragmatically — what each one buys, how to spot violations, and when NOT to apply them.
---

# SOLID design principles, applied pragmatically

SOLID (Robert C. Martin) is a lens for judging a design, not a checklist to satisfy. Each principle fights a specific kind of rot; apply one only when its rot is actually present or clearly imminent.

## Single Responsibility (SRP)
A module should have one reason to change — one actor/concern driving its evolution.
- Smell: a class or file you must edit for unrelated kinds of change (parsing AND persistence AND formatting); test setup that constructs half the app.
- Fix: split along the axis of change, not along arbitrary size. A 300-line module with one concern is fine; a 60-line one with three is not.
- Do NOT: shatter cohesive logic into micro-classes that must always change together. "One reason to change" — not "one function per file".

## Open/Closed (OCP)
Prefer designs where new behavior arrives by adding code (a new case class, strategy, handler) rather than editing a growing conditional.
- Smell: the same `switch`/`if-else` chain over a type tag repeated in several places.
- Fix: polymorphism, a handler registry, or a lookup table — but only after the second or third variant exists (rule of three).
- Do NOT: pre-build plugin architectures for a single implementation. A single switch statement in one place is simpler than an abstraction.

## Liskov Substitution (LSP)
Any implementation must be usable wherever its abstraction is expected, without the caller knowing which one it got.
- Smell: `instanceof`/type checks on an interface's implementations; overrides that throw `NotImplemented`; subclasses that weaken postconditions or strengthen preconditions.
- Fix: if an implementation can't honor the contract, the abstraction is wrong — narrow it or split it. Favor composition over inheritance when behavior diverges.

## Interface Segregation (ISP)
Callers should not depend on methods they don't use.
- Smell: "fat" interfaces where most implementations stub half the methods; a change in one client's needs forcing recompilation/retests of unrelated clients.
- Fix: split by client role (e.g. `Reader`/`Writer` instead of `Store`). Keep interfaces discovered from usage, not designed speculatively.

## Dependency Inversion (DIP)
High-level policy should not depend on low-level detail; both depend on an abstraction the policy owns.
- Smell: domain logic importing the database driver, HTTP client, or clock directly; logic untestable without real infrastructure.
- Fix: inject dependencies at the boundary (constructor/function parameter). Define the interface next to the consumer, shaped by what the consumer needs — not next to the implementation.
- Do NOT: wrap every library in a pass-through interface "for testability". Invert only at true boundaries: network, persistence, clock, randomness, OS, external services.

## When to hold back

- Single-use, application-glue code rarely needs any of this; SOLID pays off in code with multiple change drivers or multiple implementations.
- Every abstraction has a cost (indirection, naming, navigation). Introduce it when duplication or coupling hurts twice, not on the first occurrence (YAGNI + rule of three).
- Match the codebase: if the project solves this class of problem a certain way, extend that way rather than importing a new pattern.

## Quick review checklist

- Does each changed module have one clear reason to change?
- Did I extend a variant point by adding code, or by editing a third copy of a conditional?
- Can every implementation truly substitute for its interface?
- Do callers see only the operations they need?
- Does domain logic depend on abstractions it owns, with infrastructure injected?

## Further reading

- Robert C. Martin, "Design Principles and Design Patterns" (the original SOLID paper) and *Agile Software Development, Principles, Patterns, and Practices*
- Martin Fowler, martinfowler.com — "Reducing Coupling", "Refactoring"
- Sandi Metz, *Practical Object-Oriented Design* — the most pragmatic SOLID treatment
