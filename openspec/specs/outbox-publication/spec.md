# outbox-publication Specification

## Purpose
Publish committed versioned events with recoverable ownership and stable event IDs.

## Requirements

### Requirement: Atomic event creation
Integration events SHALL be concrete subclasses of IntegrationEvent, carry version 1 and persistent event IDs, and be written in the same transaction as their business decision. Balance-change events SHALL exist only when balance changes.

#### Scenario: Uncommitted financial work
- **WHEN** a financial transaction has written outbox rows but has not committed
- **THEN** a publisher cannot observe or send those rows

#### Scenario: Loss decision
- **WHEN** LOSS is processed
- **THEN** a processed event exists but no balance-change event is emitted

### Requirement: Concurrent recoverable publishing
Publishers SHALL claim with SKIP LOCKED and expiring leases, revalidate the claim before sending, and fence publication/retry updates by the live token. A failed mark after send SHALL remain retryable.

#### Scenario: Two publishers
- **WHEN** two processes drain committed outbox rows
- **THEN** they coordinate claims and preserve persistent event identities

#### Scenario: Lease ownership lost
- **WHEN** a publisher loses its lease before sending the rest of a batch
- **THEN** it stops sending that work and cannot mark another owner’s claim

### Requirement: At-least-once event delivery
Publication SHALL tolerate resend after a crash between SendMessage and marking published. Every resend SHALL retain the event ID. Consumers SHALL deduplicate event ID atomically with their own local effect; global broker exactly-once or total ordering SHALL NOT be promised.

#### Scenario: Send succeeded before crash
- **WHEN** a publisher dies after sending and before marking published
- **THEN** the expired claim is recovered and any repeated event has the same ID

## Verification references

src/domain/events.ts; src/domain/messages.ts; src/workers/outbox.ts; tests/integration/system.test.ts
