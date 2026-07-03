---
name: visual-hierarchy-and-typography
description: Make screens read in the right order — type scale and weight contrast, spacing rhythm, alignment, and restrained color that directs attention instead of decorating.
---

# Visual hierarchy and typography

A screen is an argument about what matters. The user should be able to answer "what is this page, what's the main thing, what do I do next" from a two-second glance. Hierarchy comes from deliberate contrast in size, weight, color, and space — and from restraint everywhere else.

## Typography carries the design

- Commit to the type scale in your tokens; never nudge a size off-scale to "make it fit". If two adjacent levels look too similar to matter, the scale's ratio is too timid — fix the scale, not the instance.
- Contrast in pairs: differentiate with at least two channels at once (size AND weight, or weight AND color). A 14px/600 label over 14px/400 muted body reads instantly; 15px vs 14px at the same weight reads as an accident.
- One primary heading per screen. Section titles one level down are often better SMALLER than body — small caps-ish, `font-weight: 600`, muted color, letter-spacing — than bigger.
- Body text: 14–16px, line-height 1.4–1.6, line length 45–75 characters. Dense data UIs (tables, sidebars) go to 12–13px with tighter line-height — legibility there comes from alignment and spacing, not size.
- Numbers in tables: right-aligned, `font-variant-numeric: tabular-nums`, same unit precision down the column.

## Spacing is hierarchy

Proximity groups; separation divides. Related items (label + value, icon + text) sit close (4–8px); groups separate from groups (16–24px); sections from sections (32–48px). The most common amateur tell is even spacing everywhere — it makes every element equally important, which means nothing is. Space between sections must be visibly larger than space within them. Padding inside a container ≥ the gap between its children.

## Color directs, it doesn't decorate

Most of a screen is neutrals: text on surfaces, borders, muted secondary text. The accent color marks THE primary action and active state — one saturated element per region draws the eye; five compete and cancel. Status colors (danger/success/warning) appear only on status. If a screen feels flat, add contrast in type and space before adding color. Muted text (`--color-text-muted`) is for genuinely secondary information — don't mute your way out of deciding what matters.

## Alignment and optical judgment

- Pick edges and hold them: one left rail per region, everything on it. Mixed centered-and-left-aligned content in one column reads as noise.
- Fewer boxes: separate regions with space first, a hairline border second, a background shift third. Nested boxes-in-boxes-in-boxes signal missing hierarchy decisions.
- Trust your eye over arithmetic at the detail level: icons often need 1–2px optical nudges to look centered; perfectly geometric centering of a triangle looks off. But NEVER let optical nudges leak into layout spacing — that stays on the token scale.

## The glance test

Squint (or blur mentally): the page should still show its structure — where the primary action is, where the content lives, what's grouped. Then read every word as the user: is the microcopy doing work ("Save changes", "No threads yet — start one from a repo") or filling space ("Submit", "Welcome to the platform")? Rewrite filler; the copy is part of the hierarchy.
