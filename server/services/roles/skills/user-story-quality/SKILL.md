---
name: user-story-quality
description: Write user stories that carry real intent — INVEST criteria, outcome-over-output framing, and story mapping to keep the whole visible.
---

# User story quality

A story is a placeholder for a conversation about value, not a syntax exercise. "As a…, I want…, so that…" is only useful when each slot carries information: a real user (not "as a user"), a capability (not a UI widget), and a motivation that would change the design if it changed.

## INVEST (Bill Wake)

Check every story:
- **Independent** — schedulable and shippable without dragging three other stories along. Break hidden dependencies or merge the stories.
- **Negotiable** — states the need and constraints, not the implementation. "Add a dropdown" is a design decision smuggled into a requirement; write the need ("filter results by provider") and leave the how to design.
- **Valuable** — a user or the business gets something when THIS story ships. If value only appears after five stories, the slicing is wrong (see scope-and-slicing); "technical stories" should be reframed as the capability they enable or folded into the stories needing them.
- **Estimable** — understood well enough to size. If not, the missing knowledge is the real task: split out a time-boxed spike with a question to answer.
- **Small** — a story that dominates an iteration hides unknowns; split it (by workflow step, by case, by data variation), never by architectural layer.
- **Testable** — pass/fail is decidable. "Fast", "easy", "robust" are not testable until quantified ("results render under 200ms for 1k rows").

## Outcome over output

State what becomes true for the user, not which artifacts get built. Test: could the team satisfy the story's letter while the user gains nothing? Then it's an output description. "So that" must name the actual motivation — if you can't fill it honestly, question the story's existence. Where useful, tie stories to a measurable behavior change ("support tickets about X drop") rather than feature delivery.

## Personas with teeth

"As a user" is a smell. Name the actual actor and their situation: the first-time user with an empty workspace, the returning user with 200 threads, the admin cleaning up. Different actors turn one vague story into several precise ones — and expose which states (empty, busy, error, upgrade) the spec must cover.

## Story mapping (Jeff Patton)

Keep the whole visible: lay out the user's journey left-to-right (activities → steps), then slice top-to-bottom by priority. The top row is the walking skeleton — the thinnest path through the WHOLE journey, not a polished fragment of one step. Mapping exposes gaps ("nothing covers how they get back to a saved flow"), forces real prioritization inside every step, and keeps stories anchored to the journey rather than to a backlog of disconnected wishes.

## Edge cases are part of the story

For each story, ask: what happens on failure, on empty state, on the second time, on concurrent use, at 100× the data? Either write the answers into acceptance criteria or explicitly defer them as their own stories — silence is how "done" features generate bug reports.

## Ready checklist

- Actor is specific; motivation is honest; implementation is not prescribed.
- INVEST passes, or the violation is deliberate and stated.
- Acceptance criteria exist (see acceptance-criteria-writing) covering happy path, failure, and empty/repeat states.
- Non-goals stated: what this story deliberately does NOT cover, so scope disputes get settled by the text.
- Dependencies and open questions listed — with an owner or an assumption for each.

## Further reading

- Bill Wake, "INVEST in Good Stories, and SMART Tasks" — xp123.com
- Jeff Patton, *User Story Mapping*
- Mike Cohn, *User Stories Applied*
- Marty Cagan, *Inspired* — outcome-oriented product thinking
