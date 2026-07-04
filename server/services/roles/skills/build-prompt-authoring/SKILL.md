---
name: build-prompt-authoring
description: Author self-contained, executable build prompts for a downstream coding agent — goal framing, inlined context, acceptance criteria, verification steps, and guardrails.
---

# Build prompt authoring

A build prompt is a spec compiled into a work order: one markdown document a coding agent can execute end-to-end with NO access to the conversation that produced it. If the agent would need to ask a question, the prompt is incomplete.

## Self-containment is the contract

The downstream agent sees only the prompt (and any attached artifacts injected alongside it). So:
- **Inline the substance.** Don't reference "the spec we discussed" — copy the relevant requirements, criteria, and decisions into the prompt. Referencing a prototype folder path is fine (the agent can browse files); referencing conversation history is not.
- **Resolve, don't relay, ambiguity.** Every open question from discovery is either decided (state the decision and why) or explicitly delegated ("choose either X or Y; both acceptable"). Never forward an unresolved "TBD".
- **Name the product vocabulary.** Use the repository's real entity, file, and feature names so the agent greps for the right things.

## Structure that executes well

1. **Title** — `# H1`, imperative, specific ("Add artifact attachments to build threads", not "Improvements").
2. **Goal** — 2–4 sentences: the user-visible outcome and why it matters. This is what the agent optimizes for when details conflict.
3. **Context** — what exists today: the relevant flows, files or modules if known, prototype paths, and constraints (stack, conventions, hard rules like "no ORM" or "no permission gating").
4. **Requirements** — numbered, testable statements. Each one observable in the finished product. Include the unhappy paths: error, empty, loading, permission, and edge states.
5. **Non-goals** — what NOT to build, so the agent doesn't gold-plate or wander.
6. **Acceptance criteria** — the checklist a reviewer would run. Concrete: "clicking X shows Y", "GET /api/z returns 404 for unknown ids".
7. **Verification** — the commands and manual paths that prove it: typecheck, test suite, specific manual flows to click through.

## Scope one prompt to one deliverable

A prompt should describe a single coherent change an agent can land in one run — one feature slice, not a roadmap. If the spec implies multiple independent deliverables, write multiple prompts and state their order and dependencies in each.

## Calibrate prescription to risk

Prescribe WHAT everywhere, HOW only where it matters. Over-specifying implementation details the discovery didn't actually settle invites the agent to follow a wrong guess confidently. Where the implementation approach is genuinely constrained (a migration must be append-only, a component must be reused), say so and say why; elsewhere, leave the engineering to the engineer.

## Self-review gate

Before finishing a prompt, read it as the build agent: Could you start work immediately? Is every requirement testable? Does any sentence depend on context outside the document? Would two reasonable agents build materially the same thing? Fix what fails.
