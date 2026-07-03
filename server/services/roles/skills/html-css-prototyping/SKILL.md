---
name: html-css-prototyping
description: High-fidelity prototyping in pure HTML+CSS — semantic structure, CSS-only interactivity, self-contained assets, and multi-page flow simulation without JavaScript.
---

# HTML+CSS prototyping

The constraint is the method: no JavaScript, no build step, no network. Everything a prototype needs — layout, states, navigation, imagery — is achievable with plain HTML and modern CSS, and the result is trivially inspectable by the implementer.

## Structure first

Write the page as a document, then style it: `<header>`, `<nav>`, `<main>`, `<aside>`, real headings in order, `<button>` for actions, `<a>` for navigation, `<label>` wired to every control, `<table>` for tabular data. Semantic structure is free accessibility, free keyboard behavior, and a direct map to the component tree the implementer will build. A `<div>` with a click-affordance style but no semantic element behind it is a spec bug.

## Layout

- Page skeleton with CSS Grid (`grid-template-columns`/`areas` for app shells: sidebar, header, content); component interiors with flexbox and `gap`. Never space siblings with margins where `gap` works.
- Scroll regions must be explicit: the app shell is `height: 100vh; overflow: hidden` with designated `overflow-y: auto` panes — that's a real product's behavior, and it's a layout spec the implementer needs.
- Use `min-width: 0` / `min-height: 0` on flex/grid children that must truncate; demonstrate truncation (`text-overflow: ellipsis`) with realistically long content.
- Sticky headers/toolbars via `position: sticky` inside the scroll pane.

## CSS-only interactivity

- **Navigation and flows**: plain `<a href="./next-step.html">` between pages. A button that "submits" links to the resulting page. Simulate branches (success/error) by linking both outcomes.
- **In-page states**: `:hover`, `:focus-visible`, `:active` on everything interactive; `<details>/<summary>` for accordions and disclosure; hidden `<input type="checkbox">`/`radio` + label + `:checked` sibling selectors for toggles, tabs, and switches; `:target` for modals/drawers (link opens `#modal`, a close link returns to `#`); `:placeholder-shown`, `:checked`, `:disabled` for form state styling.
- **Motion**: CSS transitions on hover/expand, small keyframe animations for skeletons/spinners (a loading-state page is allowed to animate — that's CSS, not JS).
- Don't over-engineer a CSS state machine: past ~2 interacting states, make it a separate page instead. Pages are cheap and self-documenting.

## Self-contained assets

- Fonts: system stacks only — `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` (and `ui-monospace, SFMono-Regular, Menlo, monospace` for code).
- Icons: inline `<svg>` with `stroke="currentColor"` or `fill="currentColor"` so they inherit text color and states. Draw simple 16/20/24px geometric icons; consistent stroke width across the set.
- Imagery: avatars from initials on token-colored circles; charts from divs/SVG with real-looking data; photos never — use CSS gradient/shape compositions where a visual is needed.
- Every `href`/`src` is relative and resolves inside the prototype folder. Zero external URLs — verify with a final grep for `http`.

## Multi-page hygiene

Shared chrome (nav, sidebar, header) is copy-pasted per page — keep it IDENTICAL across pages except the active-item marker (`aria-current="page"` plus its style), so paging through feels like an app, not a slideshow. Duplicated markup is fine in a prototype; drifting duplicated markup is not. When chrome changes, update every page in the same pass.
