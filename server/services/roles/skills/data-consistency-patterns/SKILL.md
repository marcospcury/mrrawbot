---
name: data-consistency-patterns
description: Keep data correct across services and stores — transactional outbox, sagas, event sourcing/CQRS tradeoffs, schema evolution, dual-write avoidance.
---

# Data consistency patterns

Once data lives in more than one place — two services, a DB and a queue, a store and a cache — "just write to both" becomes the bug. These patterns exist to make multi-store writes either atomic, compensable, or honestly eventual.

## The dual-write antipattern (start here)

Writing to the database AND publishing to a queue (or updating a cache, or calling another service) as two separate operations WILL diverge: the process dies between them, one succeeds and one fails. There is no try/catch fix. Every "we update X and also Y" in a design is a red flag demanding one of the patterns below.

## Transactional outbox

Write the business change AND an event record into the same database transaction (an `outbox` table); a separate relay reads the outbox and publishes to the broker, marking rows sent. Atomicity comes from the single local transaction; delivery is at-least-once (consumers deduplicate — see idempotency). Variant: change data capture (Debezium-style) tails the DB log instead of a relay. This is the default answer to "how do I reliably emit events?"

## Sagas — transactions across services

No distributed ACID across service boundaries; a saga is a sequence of local transactions, each with a **compensating action** to undo it if a later step fails (Garcia-Molina & Salem, 1987).
- **Choreography** (each service reacts to events) suits short simple flows; it hides the workflow in N codebases.
- **Orchestration** (an explicit coordinator drives steps) scales better in complexity: state visible, timeouts and retries in one place. Prefer it beyond ~3 steps.
- Compensation ≠ rollback: intermediate states are visible to others ("pending"), some steps aren't compensable (an email) — order steps so the hard-to-undo come last. Model the saga's own state persistently; a coordinator that forgets mid-flight is another dual-write.

## Event sourcing and CQRS — powerful, not default

- **Event sourcing**: store the events, derive state by replay. Buys a perfect audit trail, temporal queries, rebuilding read models; costs schema-evolution-forever (old events never go away — versioning/upcasters), harder ad-hoc queries, and a steep mental model. Justify it with a domain need (audit, temporal logic), not fashion.
- **CQRS**: separate write model from read model(s). Useful when read and write shapes genuinely diverge or scale differently; the read side is eventually consistent — the UX must absorb "your write isn't in this list yet" (read-your-writes via routing or optimistic UI).
- Both compose with the outbox/CDC to feed projections. Neither is required for a good architecture; a normalized store with an outbox covers most systems (Fowler: "EventSourcing", "CQRS" — including his warnings).

## Caches and derived data

Every cache is a consistency decision: bound staleness with TTLs; invalidate through the same event stream that carries the truth (not by "remembering to call invalidate"); prefer read-through/cache-aside over write-behind unless loss is acceptable. Derived stores (search indexes, materialized views, analytics) should be **rebuildable from the source of truth** — if a derived store can't be dropped and rebuilt, it has silently become a second source of truth.

## Schema and event evolution

Data outlives code; every persisted format is a contract with the past:
- Readers tolerant (ignore unknown fields, default missing ones); writers conservative.
- Additive changes first — new optional fields, new event types. Removals/renames via expand → migrate → contract, never in one step.
- Version events/messages explicitly when semantics change; keep upcasters for old versions as long as old data exists.
- Rollback compatibility: after a deploy writes vN+1 data, can vN code still run? If not, the deploy is one-way — say so in the plan.

## Concurrency at the data layer

Optimistic concurrency (version column, compare-and-set) for low-contention human-speed edits — with a designed "someone else changed this" experience; pessimistic locks/leases for high-contention or long operations, with expiry and fencing tokens. Read-modify-write without either is a lost-update bug waiting for load.

## Design review questions

- Where do we write to two places? Which pattern makes it safe?
- For each async projection/consumer: idempotent on what key? What repairs drift (reconciliation)?
- Can every derived store be rebuilt? Can vN read what vN+1 wrote?
- Which updates can race, and which strategy (optimistic/lock) covers each?

## Further reading

- Martin Kleppmann, *Designing Data-Intensive Applications* — ch. 5–9, 11–12
- Chris Richardson, microservices.io — "Saga", "Transactional Outbox", "CQRS" pattern pages
- Martin Fowler, martinfowler.com — "EventSourcing", "CQRS", "ParallelChange"
- Pat Helland, "Life beyond Distributed Transactions" (CIDR 2007)
