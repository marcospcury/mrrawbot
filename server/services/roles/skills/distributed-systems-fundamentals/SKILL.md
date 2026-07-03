---
name: distributed-systems-fundamentals
description: The non-negotiables of distributed design — partial failure, CAP/PACELC, consistency models, idempotency, delivery guarantees, clocks and ordering.
---

# Distributed systems fundamentals

A distributed system is one where a machine you've never heard of can break your feature. Design from these truths, not around them.

## Partial failure is the default

The defining property (see "A Note on Distributed Computing", Waldo et al.): a remote call has THREE outcomes — success, failure, and *unknown* (timeout: the work may or may not have happened). Every design must answer "what do we do on unknown?" — usually retry with idempotency (below). The Fallacies of Distributed Computing (Deutsch/Gosling) enumerate the assumptions to purge: the network is reliable, latency is zero, bandwidth is infinite, the topology doesn't change, transport is secure, there is one administrator, the network is homogeneous.

## CAP and PACELC

Under a network **P**artition you choose: refuse requests (**C**onsistency) or serve possibly-stale data (**A**vailability). CAP is only about partitions; PACELC (Abadi) adds the everyday tradeoff: **E**lse — even without partitions — you trade **L**atency against **C**onsistency (synchronous replication is consistent and slow; async is fast and can lose acknowledged-but-unreplicated writes on failover). Make the choice per data item, not per system: money movements and idempotency keys need CP-ish handling; presence indicators and counters tolerate staleness.

## Consistency models (know which you're promising)

- **Linearizable** — reads see the latest acknowledged write, globally ordered. Expensive; needed for uniqueness checks, leader election, "exactly one wins" decisions.
- **Sequential / causal** — causes precede effects; good default for user-facing data.
- **Read-your-writes / monotonic reads** — session guarantees; the minimum for non-confusing UX (a user must see their own update). Often violated by "write to primary, read from stale replica" — route the session or version-check.
- **Eventual** — replicas converge, no promise when. Fine for data with a merge story (CRDTs, last-writer-wins with the caveat that LWW silently drops concurrent updates).

Name the model per read path in your design. "Consistent" without a qualifier is not a spec.

## Idempotency and delivery

Exactly-once *delivery* does not exist over an unreliable network; systems achieve exactly-once *processing* as: at-least-once delivery + idempotent (or deduplicating) consumers. Concretely:
- Every retryable operation carries an **idempotency key**; the processor records processed keys (transactionally with its state change) and drops duplicates.
- Retries without idempotency are a data-corruption feature. Design the consumer first, then allow retries.
- Ordering: queues generally guarantee at most per-key/partition order. If order matters, choose the partition key so it does — or make processing commutative.

## Time and ordering

There is no global "now": clocks skew and jump (NTP steps, VM pauses). Never use wall-clock timestamps to order events across machines or as unique IDs. Use logical clocks (Lamport — total order without causality; vector clocks — detects concurrency, per Lamport's "Time, Clocks, and the Ordering of Events") or a single sequencer (one partition, a DB sequence) when true ordering is required. Timeouts + retries + clock skew are why leases, not locks, guard distributed ownership — and every lease needs fencing tokens to stop the paused-and-resumed old holder (Kleppmann's "How to do distributed locking").

## State placement

The fewest distributed problems come from having the least distributed state. Prefer: stateless services in front of one authoritative store; a single writer per datum (partition ownership) over multi-writer conflict resolution; derived data rebuilt from a source of truth over data that exists only in caches. Introduce a second source of truth only with a synchronization design (see data-consistency-patterns) — never "we'll keep them in sync in the code".

## Design review questions

- For each remote call: what happens on timeout — and is the retry safe?
- For each datum: which consistency model, and which failure loses it?
- For each queue/message: who deduplicates, and on what key? What order is actually guaranteed?
- Where do we depend on clocks, and what happens when they're wrong?
- What is the blast radius of one node/replica/AZ dying at the worst moment?

## Further reading

- Martin Kleppmann, *Designing Data-Intensive Applications* — THE reference for all of the above
- Leslie Lamport, "Time, Clocks, and the Ordering of Events in a Distributed System" (1978)
- Daniel Abadi, "PACELC" (IEEE Computer, 2012); Eric Brewer, "CAP Twelve Years Later"
- Peter Deutsch, "The Eight Fallacies of Distributed Computing"
- jepsen.io/consistency — precise consistency model map
