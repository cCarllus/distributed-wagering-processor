# wallet-ledger Specification

## Purpose
Keep wallet balances auditable and protect each account with database invariants.

## Requirements

### Requirement: Atomic wallet opening
The system SHALL enforce one wallet per player and currency. A positive opening SHALL commit the wallet, internal OPENING transaction, ledger credit and events together. Zero opening SHALL create no ledger entry. Initial wallet version SHALL be one.

#### Scenario: Positive opening
- **WHEN** a new wallet is opened with 100.00 BRL
- **THEN** its balance is 100.00, version is one and the ledger records a credit from zero

#### Scenario: Duplicate opening
- **WHEN** the same player opens another wallet in the same currency
- **THEN** the API returns WALLET_EXISTS without another wallet or credit

### Requirement: Per-wallet concurrency
The processor SHALL serialize financial decisions with a PostgreSQL wallet row lock and SHALL allow independent wallets to commit concurrently.

#### Scenario: Competing debits
- **WHEN** two operations of 80.00 concurrently target a wallet holding 100.00
- **THEN** one is processed, one is rejected and the final balance is 20.00

#### Scenario: Independent wallet
- **WHEN** wallet A is held by a transaction and an operation targets wallet B
- **THEN** B can commit without waiting for A

### Requirement: Append-only consistent ledger
PostgreSQL SHALL reject ledger UPDATE, DELETE and TRUNCATE and inconsistent balance, chain, version or transaction linkage. Wallet version SHALL increase only when balance changes.

#### Scenario: Mutation attempt
- **WHEN** DML attempts to alter an existing ledger entry
- **THEN** the database rejects it

#### Scenario: Loss or rejection
- **WHEN** a LOSS or rejected operation is committed
- **THEN** balance and version remain unchanged and no ledger entry is created

### Requirement: Stable statement and read-only reconciliation
The ledger cursor SHALL preserve ordering and the first-page upper boundary. Reconciliation SHALL report stored and reconstructed balance and SHALL NOT correct either automatically.

#### Scenario: Append during pagination
- **WHEN** a new movement arrives after the first ledger page
- **THEN** continuation excludes it and a fresh query can include it

#### Scenario: Injected discrepancy
- **WHEN** the stored balance differs from the ledger in the corruption test
- **THEN** reconciliation reports the difference without changing financial records

## Verification references

src/domain/wallet.ts; src/infrastructure/persistence/{store,queries}.ts; src/infrastructure/persistence/migrations/; tests/integration/system.test.ts
