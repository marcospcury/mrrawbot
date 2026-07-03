---
name: design-token-systems
description: Build a two-tier design token system in CSS custom properties — primitives, semantic roles, scales for color/type/space, and theme switching.
---

# Design token systems

Tokens are the contract between design and implementation. A screen built from tokens can be re-skinned, themed, and implemented mechanically; a screen built from magic numbers has to be reverse-engineered. Every color, size, radius, shadow, and duration in the prototype should trace to a custom property in `tokens.css`.

## Two tiers: primitives, then semantics

- **Primitives** name raw values with no opinion about use: `--blue-600: #2563eb`, `--gray-100`, `--size-4: 1rem`. They form scales, not one-offs.
- **Semantic tokens** name roles and reference primitives: `--color-bg-surface: var(--gray-50)`, `--color-text-muted`, `--color-accent`, `--color-border`, `--color-danger`. Components consume ONLY semantic tokens — that's what makes theming a re-mapping exercise instead of a rewrite.

Name semantics by role (`bg`, `text`, `border`, `accent`, `danger`, `success`), not by appearance (`--light-blue`) and not by location (`--sidebar-button-color`) — location-named tokens multiply forever. A component that genuinely needs its own knob gets a component-scoped alias referencing a semantic token.

## Scales, not values

- **Color**: build stepped ramps (50–900) per hue; pick text/background pairs from the ramp so contrast is checkable. Keep one accent; add danger/warning/success only when the product uses them.
- **Type**: a deliberate scale (e.g. 12/13/14/16/20/24/32 or a modular ratio) with matching line-heights and 2–3 weights. Every font-size in the prototype comes off the scale.
- **Space**: one geometric scale (4/8/12/16/24/32/48/64) used for ALL padding, gaps, and margins. Spacing rhythm is what makes a design feel finished; off-scale one-offs are what make it feel wobbly.
- **Radius, shadow, motion**: small fixed sets (`--radius-sm/md/lg`, 2–3 elevation shadows, 1–2 durations + easings). More options than that is indecision, not flexibility.

## Theming

Define primitives once; define semantic mappings per theme. Default theme on `:root`; the alternate under `@media (prefers-color-scheme: dark)` AND a `:root[data-theme="dark"]` override so an explicit toggle beats the OS setting. Dark mode is a re-mapping (surfaces rise in lightness at higher elevation, shadows weaken, saturated colors desaturate slightly) — never `filter: invert()`, never re-deriving colors ad hoc per component.

## Mirroring an existing product

When the repository already has tokens (CSS custom properties, Tailwind theme, styled-system config), your `tokens.css` mirrors THEIR names and values, and the handoff notes map each of your tokens to the product token it corresponds to. Inventing a parallel palette for a product that has one is a handoff failure — the implementer must be able to substitute the real system in one pass.

## Self-check

Grep your own pages: any hex color, `px` font-size, or numeric padding outside `tokens.css` should either become a token or have a reason. Verify every text/background token pair meets 4.5:1 (3:1 for ≥ 24px text). Count your accents: more than one accent hue must be a deliberate, documented choice.
