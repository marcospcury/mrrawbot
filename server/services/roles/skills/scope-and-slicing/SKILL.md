---
name: scope-and-slicing
description: Define scope honestly and slice work into thin vertical increments — goals/non-goals, walking skeleton, SPIDR splitting, and assumption surfacing.
---

# Scope definition and slicing

Most delivery failures are scope failures: the spec silently included things nobody meant to build, excluded things everybody assumed, or arrived as one indivisible boulder. Your job is to make scope explicit and cut it into thin, whole slices.

## Goals and non-goals, always

Every spec states both:
- **Goals** — the outcomes this work must achieve, each traceable to a user or business need. If a requirement serves no goal, cut it.
- **Non-goals** — the adjacent things this work deliberately does NOT do (platforms not supported, scales not handled, features intentionally deferred). Non-goals are where scope disputes go to be settled in advance; an empty non-goals section means nobody looked for the boundary. Writing them down converts future "but I assumed…" arguments into a sentence someone approved.

## Slice vertically, not by layer

A slice must cross the whole stack and leave the user able to do something new — however narrow. "Build the schema", "build the API", "build the UI" are layers, not slices: no layer is testable against real use, and integration risk piles up at the end. Start with the **walking skeleton**: the thinnest end-to-end path through the entire workflow, ugly but complete. Every later slice widens it. Working end-to-end beats polished-in-parts.

## SPIDR: five ways to split a big story (Mike Cohn)

- **Spikes** — unknown technology or feasibility? Split out a time-boxed investigation whose deliverable is an answer, not code.
- **Paths** — split by workflow variation: happy path first; alternate flows, bulk operations, and error recovery as their own slices.
- **Interfaces** — one platform/browser/input-method first; support matrix later. Or a crude interface first, refined later.
- **Data** — support one data type/format/subset first ("English only", "single repo", "files under 10MB"), extend later.
- **Rules** — relax business rules initially, tighten in follow-up slices ("no rate limits in v1, manual review instead").

Complementary micro-heuristics: split at every "and/or" in a story; separate CRUD verbs (create first, edit/delete later); defer performance and hardening to explicit slices *only when* the deferral is written down as a non-goal.

## Prioritize by value AND risk

Order slices to kill the biggest risk earliest — the unproven integration, the unvalidated user need — not to bank easy wins first. A cheap slice that tests the riskiest assumption beats a polished slice that proves nothing. Make the tradeoff visible: for each deferred item, one line on what deferring costs.

## Surface assumptions and open questions

A spec's silent assumptions are its bugs. List them explicitly, each with a resolution: an owner to confirm, a default chosen ("assuming single-user; multi-user is a non-goal"), or a spike to answer. Mark which assumptions, if wrong, invalidate the design — those get resolved first, not discovered in code review.

## Scope-cut integrity

When cutting to fit, cut whole slices (drop a path, a data type, a rule) — never cut quality invisibly (skipping error states, tests, or edge handling while claiming the feature is "done"). An honest smaller scope beats a dishonest full one; the skipped part becomes a named, visible slice in the backlog.

## Checklist

- Goals each traceable to a need; non-goals section non-empty.
- First slice is a walking skeleton; every slice is vertical and demoable.
- Riskiest assumption addressed by the earliest possible slice.
- Assumptions listed with owners/defaults; design-invalidating ones flagged.
- Cuts made by dropping slices, not by hollowing out quality.

## Further reading

- Mike Cohn, "Five Simple but Powerful Ways to Split User Stories" (SPIDR) — mountaingoatsoftware.com
- Alistair Cockburn — walking skeleton, in *Crystal Clear*
- Jeff Patton, *User Story Mapping* — slicing releases across the journey
- Henrik Kniberg, "Making sense of MVP" — the skateboard→car picture
