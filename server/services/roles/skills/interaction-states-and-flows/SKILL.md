---
name: interaction-states-and-flows
description: Design every state a screen actually has — empty, loading, partial, error, success, edge — and stitch pages into clickable flows that simulate the real product.
---

# Interaction states and flows

The happy path with perfect data is the easiest 20% of a design and the least likely to expose problems. Screens spend real life empty, loading, failing, and overflowing — and a prototype that skips those states pushes the hardest design decisions onto the implementer, who will resolve them by accident.

## The state checklist per screen

Walk every screen through this list and either design the state or note why it can't occur:

- **Empty / first-run** — the most important state for adoption: what does a new user see, and does it teach them what this screen is for and offer the one action that fills it? An empty table with just headers is a missing design.
- **Loading** — skeletons shaped like the loaded content (CSS-animated) beat spinners for content regions; spinners are for actions. Decide what remains interactive while loading.
- **Partial / sparse** — one item, not twenty. Does the layout still look intentional?
- **Ideal** — the state you were going to design anyway, with realistic volume.
- **Overflow / edge** — the 300-character name, 1,000 rows, zero search results, deeply nested item. Show truncation, wrapping, pagination or scroll behavior explicitly.
- **Error** — per-field validation (message at the field, in danger color, with recovery wording) and whole-screen failure (what's retryable?). Error copy says what happened AND what to do.
- **Success / confirmation** — after the action: inline toast, changed state, or a next-step page?

Interactive-element states (hover, focus-visible, active, disabled, selected) live in the shared stylesheet so they're consistent everywhere; screen-level states get their own pages or CSS-only views.

## Flows are the product

A feature is a path, not a screen. Map the flow before styling: entry point → steps → decision points → success and failure exits. Then build it as linked pages so clicking through IS using the feature:

- Each step links forward via its primary action; a "submit" with both outcomes links to the success page prominently and the error/validation variant nearby (a small labeled link is fine — it's a prototype affordance, not product UI).
- Show where the user came from and where they can go: breadcrumbs, back links, active nav state (`aria-current="page"`). Dead-end pages break the illusion of an app.
- Cancel/escape routes are design decisions: what's abandoned, what's kept, where does the user land?
- Keep one canonical flow order in `index.html`'s page map so a reviewer can walk it without instructions.

## State variants without JavaScript

Prefer a separate page per screen-level state (`inbox.html`, `inbox-empty.html`, `inbox-error.html`) — pages are self-documenting and linkable from the handoff. Use CSS-only mechanisms (`:target` modals, `:checked` tabs) for states that are truly in-place micro-interactions. Never fake a state by describing it in a note when you could show it.

## Realistic data is a design tool

Populate states with data that stress-tests the layout: names of wildly different lengths, dates spanning years, statuses in every value, one row mid-edit. If the design survives your worst realistic row, it ships; if every row is "John Smith — Active", the design has been tested against nothing.
