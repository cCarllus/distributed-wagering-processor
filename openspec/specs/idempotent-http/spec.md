# idempotent-http Specification

## Purpose
Expose financial contracts with persistent idempotency and historical replay results.

## Requirements

### Requirement: Persistent business identity
Transaction submission SHALL require Idempotency-Key and hash canonical business fields after UUID normalization. A key or provider/external ID reused with divergent business data SHALL return a conflict. A compatible new key SHALL be bound as a persistent alias.

#### Scenario: Fifty duplicates across processes
- **WHEN** 50 identical requests reach at least three Nest processes
- **THEN** one financial effect is committed and every successful response identifies the same transaction

#### Scenario: Divergent identity
- **WHEN** an existing key or provider/external pair is reused with a different amount
- **THEN** the response is IDEMPOTENCY_CONFLICT or EXTERNAL_ID_CONFLICT and balance does not change

### Requirement: Original decision on replay
The system SHALL persist the balance returned with each terminal decision and replay that balance after later movements or service restart.

#### Scenario: Replay after other movements
- **WHEN** a BET originally returned balance 70.00 and later operations brought the wallet to 100.00
- **THEN** replaying the BET returns 70.00 and the original transaction ID

### Requirement: Complete HTTP boundary
The API SHALL expose wallet creation/read, stable ledger pages, reconciliation, transaction submission, internal and provider/external lookup, liveness and readiness. It SHALL distinguish validation, absence, conflict, business rejection, pending reference and transient failure.

#### Scenario: Response classification
- **WHEN** requests produce invalid payload, conflict, rejection, pending reference and infrastructure failure
- **THEN** submission returns 400, 409, 422, 202 and 503 respectively with stable diagnostic codes or a durable transaction ID

#### Scenario: Rejected decision lookup
- **WHEN** a client reads a rejected transaction by ID
- **THEN** GET returns 200 with its persisted status and failure code

## Verification references

src/application/contracts.ts; src/application/process-wager.ts; src/http/api.ts; tests/integration/system.test.ts
