## ADDED Requirements

### Requirement: Reproducible local toolchain
The repository SHALL pin runtime, direct dependencies, lockfile and official container images, provide reversible migrations and a documented zero-to-running path. The server SHALL run Nest decorators under Bun in practice.

#### Scenario: Clean setup
- **WHEN** dependencies are installed with the frozen lockfile and Compose is started
- **THEN** migrations, local queues, compiled frontend and Nest API become usable

### Requirement: Real integration proof
The suite SHALL use real PostgreSQL and local SQS and cover migrations, constraints, atomicity, at least three application processes, concurrent duplicates/debits, independent wallets, two publishers, crashes, retry/DLQ, out-of-order references and restart. Every financial scenario SHALL reconcile balances from the ledger.

#### Scenario: Infrastructure absent
- **WHEN** integration tests run without their containers
- **THEN** the suite fails rather than reporting skipped integration as success

#### Scenario: Final balance reconstruction
- **WHEN** each integration scenario completes
- **THEN** every persisted wallet balance equals the ledger sum

### Requirement: Traceable retrospective baseline
OpenSpec SHALL identify this initial baseline as authored after implementation and testing on 2026-11-16. Archive tasks SHALL describe completed recording/verification work and SHALL NOT imply these specs preceded implementation.

#### Scenario: Reviewer inspects archive
- **WHEN** a reviewer opens the archived recording changes
- **THEN** the adoption date, retrospective scope, source revision, implementation links and executed checks are explicit

## Verification references

package.json; bun.lock; compose.yaml; Dockerfile; tests/; README.md; openspec/config.yaml
