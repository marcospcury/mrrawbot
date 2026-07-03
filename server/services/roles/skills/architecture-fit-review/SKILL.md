---
name: architecture-fit-review
description: Verify a proposed solution actually fits the existing architecture — right layer, existing patterns, preserved contracts — before committing to it.
---

# Architecture fit review

A solution can be locally correct and still wrong: in the wrong layer, duplicating a mechanism that already exists, or quietly breaking a contract the architecture depends on. Before committing to (or approving) an approach, hold it against the architecture as it actually is — not as you assume it is.

## Step 1: establish the actual architecture

From evidence, not memory: read the project's instruction/architecture docs, the directory layout, and 2–3 existing features similar to the one being changed. Write down, in a few lines: the layers and what each owns; how data flows for this kind of operation; where state lives; how errors, config, and cross-cutting concerns are handled. If you can't sketch this, you're not ready to judge fit.

## Step 2: the fit checklist

- **Right layer / right owner.** Does the change land where this responsibility already lives, or does it smuggle logic into a component that merely has access to the data? (Business rules in a UI handler, rendering decisions in the API, persistence in the domain layer are the classic misplacements.)
- **Existing pattern or parallel invention?** How do the 2–3 similar existing features do it? A new mechanism alongside an established one ("the second way to register a handler") is a permanent tax; either reuse the existing pattern or explicitly migrate it — never silently fork it.
- **Contracts preserved.** Public APIs, schemas, event shapes, file formats, URL/CLI surfaces: unchanged, or changed deliberately with versioning/migration? List each contract the approach touches.
- **Dependency direction.** Do dependencies still point the right way (domain not importing infrastructure, lower layers not reaching up)? Does the change introduce a cycle or a new coupling between previously independent modules?
- **Discoverability.** Would a maintainer looking for this behavior look where you put it? Would they be surprised by the mechanism?
- **Consistency of state.** Does the approach respect the architecture's single source of truth, or does it introduce a second copy of state that must now be kept in sync?
- **Constraint compliance.** Check the project's stated hard constraints (instruction files) one by one — performance budgets, offline/local-first requirements, no-ORM rules, platform support. A design that violates a stated constraint is wrong no matter how clean.

## Step 3: right-size the solution

Two failure modes, equally bad:
- **The hack**: fits the deadline, fights the architecture — a special case bolted where a seam already exists, state duplicated because plumbing it properly is tedious. It works today and taxes every change after.
- **The rewrite**: exceeds the task — new abstraction layers, speculative generality, "while we're here" restructuring. Prefer evolutionary steps: the smallest design that fits, with clear seams where expected change can attach later.

If the *right* solution requires refactoring first, stage it: behavior-preserving preparation, then the change — don't blend them, and don't skip to the hack.

## Step 4: challenge it

Before finalizing, articulate the strongest case AGAINST the chosen approach: what would a skeptical senior engineer attack? If you can't defeat the attack with evidence, the design isn't settled. Compare at least one genuine alternative and record, in a line, why it lost — "considered and rejected because X" is what makes a design reviewable.

## Verdict format

State: the approach, the layer(s) it lands in, the existing pattern it follows (name the precedent file), the contracts it touches and how each is protected, and the alternative(s) rejected with reasons. If any checklist item fails, either fix the design or state the deliberate exception and why it's acceptable.

## Further reading

- Martin Fowler, martinfowler.com — "Who Needs an Architect?", "Evolutionary Architecture", "TechnicalDebtQuadrant"
- Neal Ford, Rebecca Parsons, Patrick Kua, *Building Evolutionary Architectures* — fitness functions
- Michael Nygard, "Documenting Architecture Decisions" (ADRs)
