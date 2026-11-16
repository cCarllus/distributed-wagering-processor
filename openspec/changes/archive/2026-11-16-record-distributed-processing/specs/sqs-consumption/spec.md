## ADDED Requirements

### Requirement: Local FIFO and durable inbox
The consumer SHALL use wager-transactions.fifo and wager-transactions-dlq.fifo in local SQS, group by wallet and execute the shared ProcessWager use case. Inbox identity SHALL be persistent and part of the financial commit.

#### Scenario: Transport deduplication expires
- **WHEN** the same logical message arrives with another transport deduplication ID
- **THEN** the inbox and business identities prevent another financial effect

#### Scenario: Conflicting inbox message
- **WHEN** a messageId is reused with a different business payload or key
- **THEN** the conflict is routed to DLQ without financial mutation

### Requirement: Commit before acknowledgment
The consumer SHALL ACK only after committing inbox, decision, wallet, ledger and outbox. ACK failure SHALL NOT replace an already committed decision with FAILED.

#### Scenario: Crash before ACK
- **WHEN** the consumer is killed after commit and before DeleteMessage
- **THEN** redelivery returns the original decision and commits no additional movement

#### Scenario: Uncertain commit at delivery limit
- **WHEN** commit succeeded but its response was lost on the final delivery attempt
- **THEN** durable identity resolves the outcome and a successful decision is acknowledged

### Requirement: Bounded retries and recoverable DLQ
Transient failures SHALL use bounded exponential visibility backoff. Permanent or exhausted valid operations SHALL persist FAILED when the database is available. DLQ send SHALL precede ACK; a replay of FAILED SHALL finish an interrupted DLQ send.

#### Scenario: Persistent database outage
- **WHEN** the database remains inaccessible through the receive budget
- **THEN** broker redrive can move the message to DLQ without claiming a SQL audit was written

#### Scenario: Shutdown during heartbeat
- **WHEN** graceful shutdown begins with a visibility extension in flight
- **THEN** the worker waits for that extension before final visibility changes and drains work

## Verification references

src/workers/consumer.ts; src/workers/heartbeat.ts; src/infrastructure/messaging/sqs.ts; tests/fixtures/; tests/integration/system.test.ts
