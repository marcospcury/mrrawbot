---
name: edge-case-catalog
description: Systematic catalog of edge cases and failure modes to walk against any change — inputs, state, concurrency, failure, environment, scale.
---

# Edge case catalog

Intuition finds the edge cases you already thought of. A catalog finds the rest. Walk every category against the change; for each hit, decide where it is handled (existing code, new code, a test, or an explicit "not relevant because…"). An unexamined category is a risk, not a default pass.

## Inputs

- **Emptiness**: empty string, empty list/map, zero, null/undefined/missing field, whitespace-only, file of zero bytes.
- **Boundaries**: min/max values, exactly-at-limit and one-past-limit lengths, off-by-one in ranges and pagination, first and last element.
- **Duplicates & ordering**: repeated items, same key twice, unsorted input where sorted is assumed (and vice versa), stability of sorts.
- **Text**: unicode (emoji, combining marks, RTL), case sensitivity, leading/trailing whitespace, newlines in "single-line" fields, very long tokens without spaces.
- **Paths & names**: spaces, quotes, unicode, symlinks, relative vs absolute, trailing slash, case-insensitive filesystems, reserved names.
- **Numbers**: negative where positive assumed, floating-point precision, integer overflow, NaN/Infinity, string-vs-number type coercion.
- **Format**: malformed JSON/YAML, unexpected extra fields, missing optional-that-was-assumed-present, wrong encoding, huge payloads.

## State

- **First run vs upgrade**: fresh install with nothing persisted; existing users with data written by every previous version (old schema rows, old config keys, old cache formats).
- **Absent prerequisites**: directory/table/config not yet created, dependency not installed, service not running.
- **Stale state**: cache out of sync with source of truth, leftover lock/temp files from a crashed run.
- **Boundary states of entities**: just-created, being-deleted, soft-deleted, archived, the only-one-left, the default one.

## Concurrency & repetition

- Same operation invoked twice (double-click, retry, replayed message) — is it idempotent?
- Two actors mutating the same entity concurrently — lost update, read-modify-write races, TOCTOU.
- Re-entrancy: callback/event firing while the handler is still running.
- Cancellation mid-operation: abort signal between step A and step B — what state is left behind?

## Failure

- Each external call failing: timeout, refusal, 5xx, malformed response, success-after-timeout (the work happened but you didn't hear).
- **Partial failure**: multi-step operation dying in the middle — which steps are atomic, what does recovery/retry see?
- Resource exhaustion: disk full, out of memory/file descriptors, quota/rate limit hit.
- Error paths of error handling: what happens when the logger, the cleanup, or the rollback itself fails?

## Environment & time

- Clock: timezone/DST, system clock jumping backwards, tasks spanning midnight/year-end, leap days, epoch-vs-ISO confusion.
- Locale: decimal comma, non-ASCII default encodings, date formats.
- Platform differences the project supports: OS path separators, line endings, case sensitivity, shell availability.
- Permissions: read-only filesystem, missing rights on one file inside a tree.

## Scale

- 0, 1, and N where N is 10–1000× your test data: does anything load everything into memory, render everything into the DOM, or fire N sequential network calls?
- Deeply nested structures, pathological recursion depth.
- Hot paths called in a loop that were designed for once-per-request.

## How to use this catalog

1. Walk each category against the change; most will take seconds to dismiss.
2. For each relevant case, write down: where handled / which test proves it / or the accepted risk.
3. In plans and reviews, list the dismissed categories in one line — "considered and not relevant" is information; silence is not.

## Further reading

- Glenford Myers, *The Art of Software Testing* — boundary value analysis, equivalence partitioning
- "Falsehoods programmers believe about…" series (names, time, addresses) — github.com/kdeldycke/awesome-falsehood
