# system-verification Specification

## Purpose
Keep the local challenge reproducible and distinguish executed validation from design intent.

## Requirements

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

### Requirement: Hosted continuous integration
GitHub Actions SHALL run documentation checks, lint, typecheck, build and the complete Bun suite on pushes to main, pull requests and manual dispatch. The suite SHALL use the project's Compose PostgreSQL and LocalStack services, with no integration skips. Workflow actions and Bun SHALL be pinned. The workflow SHALL preserve failing command exit codes, collect diagnostic reports, clean up its containers and publish compiled artifacts only after successful validation. It SHALL require no custom secrets or deployment permissions.

#### Scenario: Change reaches GitHub
- **WHEN** a push or pull request triggers the workflow
- **THEN** the tested commit receives the actual validation result, including failures caused by missing infrastructure

#### Scenario: Integration failure
- **WHEN** a test fails while its output is recorded
- **THEN** the job fails, diagnostic collection runs before cleanup and no successful build artifact is published

## Verification references

package.json; bun.lock; compose.yaml; Dockerfile; tests/; README.md; openspec/config.yaml; .github/workflows/ci.yml; guide/testes.md
