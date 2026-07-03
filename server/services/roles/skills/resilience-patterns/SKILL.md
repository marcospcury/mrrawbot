---
name: resilience-patterns
description: Keep systems alive under failure — timeouts, retries with backoff and jitter, circuit breakers, bulkheads, backpressure, load shedding, DLQs, graceful degradation.
---

# Resilience patterns

Resilience is not "handle errors" — it is designing so that one component's failure stays *its* failure instead of cascading. These patterns compose; most incidents trace to a missing one.

## Timeouts (the foundation)

Every remote call gets an explicit timeout; the platform default is usually "infinite" or wrong. Budget end-to-end: if the caller gives you 2s, your downstream calls must fit inside it (deadline propagation), otherwise you do work nobody is waiting for. A missing timeout turns a slow dependency into your outage: threads/sockets pile up until you fall over too (see cascading failure, Nygard's *Release It!*).

## Retries — the most dangerous "fix"

- Retry only **transient** failures (timeouts, 503, connection reset) — never business rejections (400, validation, insufficient funds).
- Retry only **idempotent** operations, or attach idempotency keys first.
- Always **exponential backoff + jitter** (AWS's "Exponential Backoff and Jitter"): synchronized bare retries create thundering herds that finish off a recovering service.
- **Cap total attempts and total time**; retry at ONE layer only — three layers each retrying 3× is a 27× amplifier (retry storms).
- A retry burns capacity when the system is already hurting: pair with a budget (e.g. retries ≤ 10% of requests) or a circuit breaker.

## Circuit breakers

Stop calling a dependency that keeps failing: after a threshold of failures the breaker **opens** (calls fail fast — no threads parked on a dead service), then **half-open** trial calls probe recovery, then it **closes**. Fail-fast gives the dependency room to recover and gives you a defined degraded behavior instead of a hang. Per-dependency, not global; expose breaker state in metrics — an open breaker is an alert. (Fowler's "CircuitBreaker"; Nygard.)

## Bulkheads and isolation

Partition resources so one failing consumer can't drain the pool everyone shares: separate connection pools/thread pools/queues per dependency or per tenant class; separate critical from best-effort traffic. The slow "reports" endpoint must not exhaust the connections that "checkout" needs. Same idea at larger scale: cell-based deployment, per-AZ independence.

## Backpressure and load shedding

Unbounded queues turn overload into latency (the queue absorbs demand until every request is slow AND doomed) and then into OOM. Bound every queue; when full, push back (block/reject upstream) or shed load deliberately: reject cheap-to-reject work early, prioritize what matters, return a fast "try later" over a slow failure. Little's law tells you queue length × service rate = wait time — a queue longer than clients' patience serves corpses. Related: admission control and "goodput vs throughput" (SRE book's "Handling Overload").

## Failing gracefully

- **Fallbacks**: a degraded answer beats an error when the domain allows — cached last-known-good, defaults, reduced feature set. Every fallback is a product decision: state what the user sees.
- **Graceful degradation ladder**: define in the design which features shut off first under stress.
- **Fail static**: systems that keep serving the last good configuration/data when the control plane dies.

## Asynchronous safety nets

- **Dead-letter queues**: after N failed processing attempts, park the message + error context in a DLQ with alerting and a replay path — poison messages must not block the queue or be silently dropped.
- **Reconciliation loops**: periodic jobs that compare derived state to the source of truth and repair drift — the backstop for every "should never happen".

## Verify it (chaos engineering)

A resilience mechanism that has never fired in a test fires wrong in production. Inject the failures in tests/staging: kill the dependency, add latency, fill the queue, open the breaker. (Principles: principlesofchaos.org.)

## Design review questions

- Which call lacks a timeout? Which retry lacks backoff+jitter, idempotency, or a cap?
- What happens when each dependency is down 10 minutes — and when it comes back (thundering herd)?
- Which queue is unbounded? Where does overload go?
- What does the user see during each degradation, and did anyone decide that on purpose?

## Further reading

- Michael Nygard, *Release It!* (2nd ed.) — stability patterns and antipatterns; the canonical text
- Marc Brooker (AWS builders' library) — "Timeouts, retries, and backoff with jitter"
- Google SRE book — "Handling Overload", "Addressing Cascading Failures"
- Martin Fowler, "CircuitBreaker" — martinfowler.com
