## ADDED Requirements

### Requirement: Structured correlated telemetry
Logs SHALL include correlation and transaction/message identifiers without full payloads, credentials or SQL parameters. Metrics SHALL expose decisions, duplicates, retries, DLQ, lock conflicts, outbox lag, processing latency and reconciliation discrepancies.

#### Scenario: Committed operation
- **WHEN** a transaction commits
- **THEN** structured telemetry records its identifiers/status and relevant counters advance

### Requirement: Dependency-aware readiness
Liveness SHALL reflect the process while readiness SHALL check PostgreSQL and all three queues. Dashboard health SHALL separate dependency results without returning raw driver errors.

#### Scenario: SQS unavailable
- **WHEN** the API process is alive but SQS is unavailable
- **THEN** liveness returns 200 and readiness returns 503

### Requirement: Explicit local boundary
Configuration SHALL restrict PostgreSQL and SQS to the fictional local setup and SHALL NOT load host AWS credentials. Documentation SHALL state that external authentication and production operation are out of scope.

#### Scenario: External service configuration
- **WHEN** configuration points to a real remote database or AWS endpoint
- **THEN** startup rejects the unsupported destination

## Verification references

src/config.ts; src/infrastructure/observability/telemetry.ts; src/http/api.ts; tests/integration/system.test.ts
