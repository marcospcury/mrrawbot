---
name: plan-step-authoring
description: Write plan steps a smaller model can execute safely — self-contained context, precise locations, explicit guards, and per-step verification.
---

# Authoring plan steps for a smaller executor

Your plan's steps will be executed one at a time by an agent that may be a smaller, more literal model. It sees ONLY the current step's text plus one-line summaries of completed steps — none of your investigation, none of the other steps' detail. Write each step as if handing a card to a capable junior with zero context and a tendency to improvise when confused. The plan's job is to make improvisation unnecessary and, where assumptions might have drifted, impossible to act on silently.

## The anatomy of a step

Every step carries four parts:

1. **Context** — why this step exists and the minimum background to act: which files are involved, what the relevant code currently looks like (a one-line description or short excerpt), and any decision already made that this step relies on. Restate it even if another step said it; steps share nothing.
2. **Actions** — the precise instructions. Exact file paths, exact symbol names, and the insertion point ("in `server/api/git.ts`, inside `handlePush()`, immediately after the `validateRemote(...)` call"). Where wording could be read two ways, include the exact signature, type shape, or a short code sketch. Name the convention to imitate ("follow the shape of the adjacent `listBranches` handler").
3. **Guards** — what the step must NOT do, and a precondition check. Scope guards: "touch only `<files>`; do not rename existing exports; do not add dependencies; do not reformat unrelated code." Precondition: "First confirm `<symbol>` exists in `<file>` and looks like `<shape>`. If it does not, STOP and report the mismatch instead of adapting the plan yourself." Drifted assumptions must halt, not mutate.
4. **Verify** — one concrete command and its expected outcome ("run `npm test -- --run server/api/git.test.ts`; all tests pass, including the two added in this step"). Never "verify it works."

## Sizing and ordering

- One reviewable, independently verifiable change per step. If the Actions need "and also", split the step.
- Order steps so the project builds, typechecks, and passes existing tests after EVERY step — no step may rely on a later step to become correct. When a change can't be green mid-way, restructure (add the new path first, switch callers, remove the old path last).
- Preparatory refactors (behavior-preserving) come first, as their own steps, verified by existing tests staying green.
- Tests are first-class steps with the same four parts, including exactly which behaviors the new tests must assert.
- The final step is always full verification: the project's complete test/typecheck/lint commands and a diff review against the plan's stated non-goals.

## Language rules

- No references outside the step: never "as discussed above", "the file from step 3", "the approach we chose".
- No vague verbs: "improve", "clean up", "handle properly", "make robust" are banned. Say what to add, where, and what it does.
- No implicit knowledge: name the test runner and the exact command; name the directory a new file belongs in; state the naming convention for the new symbol.
- Quantify done: "Done when: `<command>` prints `<observable outcome>`."

## Self-test before emitting the plan

For each step, ask: could a literal-minded junior with no repository knowledge beyond this card do the right thing — and would they STOP (not improvise) if the code didn't match the card? If either answer is no, the step needs more context, tighter guards, or a split.

If the runtime requires a structured plan output (e.g. a `plan-json` block), put the FULL four-part text into each step's `prompt` field and the exact command into `verify` — the executor receives nothing else.
