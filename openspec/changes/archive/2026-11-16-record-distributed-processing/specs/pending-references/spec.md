## ADDED Requirements

### Requirement: Durable pending state
A valid missing reference SHALL persist PENDING_REFERENCE with retry count, schedule and deadline, and release transport responsibility after commit.

#### Scenario: Refund before bet
- **WHEN** REFUND arrives over SQS before its BET
- **THEN** the refund remains pending, is acknowledged and can be resolved after the BET commits

### Requirement: Bounded resolution without starvation
Reference work SHALL lock by wallet, skip busy wallets and recheck state and TTL after claim. Defaults SHALL allow 12 deferrals with exponential backoff capped at 300 seconds and a 24-hour TTL.

#### Scenario: Busy wallet queue
- **WHEN** 26 pending references belong to a locked wallet while another wallet has due work
- **THEN** the second wallet can still be selected and processed

#### Scenario: Late reference after expiry
- **WHEN** the referenced BET arrives after the pending operation’s TTL
- **THEN** the pending operation is rejected with REFERENCE_NOT_FOUND rather than resurrected

#### Scenario: Restart
- **WHEN** the reference worker restarts between attempts
- **THEN** the retry count, next attempt and deadline remain intact

## Verification references

src/workers/references.ts; src/application/process-wager.ts; src/domain/wager.ts; src/infrastructure/persistence/store.ts; tests/integration/system.test.ts
