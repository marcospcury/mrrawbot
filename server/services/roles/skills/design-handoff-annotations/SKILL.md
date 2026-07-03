---
name: design-handoff-annotations
description: Write the HANDOFF.md that lets an implementer rebuild the prototype in the real stack without guessing — page map, token mapping, component inventory, layout specs, and protected decisions.
---

# Design handoff annotations

The prototype answers "what should it look like"; the handoff answers "how do I rebuild this in the real codebase without re-deciding anything". Its reader is an implementation agent that will see the prototype files and the handoff — not your reasoning. Anything you decided but didn't write down will be re-decided, probably differently.

## Page map

List every page: filename, one-line purpose, and its flow edges ("checkout-shipping.html → checkout-payment.html on 'Continue'; → cart.html on 'Back'"). Mark the canonical happy path through the flow, and label state-variant pages as variants of their base screen ("inbox-empty.html — empty state of inbox.html") so the implementer knows they're one component in different states, not separate screens.

## Token mapping — the highest-value section

For each token in `tokens.css`: name, value, role, and — critically — its mapping into the product's real system: "matches existing `--color-surface-2` in src/index.css", "new: product has no danger ramp, add one", "replaces the hardcoded #e5e7eb borders used in table components". The implementer should be able to mechanically translate `var(--color-bg-raised)` into the product's actual token or utility class. A token table without the mapping column forces the implementer to re-derive your entire analysis of the existing design system.

## Component inventory

Each reusable piece you built (button, input, card, table, nav item, badge, modal…): variants (primary/secondary/ghost…), states covered (hover/focus/disabled/selected), and its mapping to the product's existing component ("use the existing `<Button variant='outline'>`; add the missing `size='xs'`" / "new component, no equivalent exists"). Distinguish reuse / extend / create — it's the difference between a day and a week of implementation.

## Layout and behavior specs

Screenshots underdetermine behavior. Write down what a static page can't prove:

- Grid structure and dimensions: column counts, fixed vs fluid widths, min/max constraints, breakpoints and what reflows at each.
- Scroll architecture: which panes scroll independently, what's sticky, what's fixed.
- Truncation and overflow rules per region ("thread titles: single line, ellipsis; message body: wraps, no clamp").
- Z-layering and elevation order for overlapping surfaces.
- Motion intent: what transitions, roughly how fast, and what should NOT animate.

## Decisions, assumptions, and guardrails

Record ambiguous points you resolved and why ("task didn't specify bulk actions; added a selection column because the table exceeds one screen — remove if out of scope"), plus explicit do-not-"fix" notes for choices that look like accidents but aren't ("the sidebar intentionally lacks a border; separation comes from the background shift"). This section is what keeps the design surviving contact with an implementer's defaults.

## Calibration

The handoff is a reference, not a novel: tables and terse bullets over prose, and nothing that merely restates what reading the HTML makes obvious. The test for every line: would the implementer otherwise have to guess? If reading the file answers it, cut the line; if a screenshot can't answer it, write it down.
