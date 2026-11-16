# wager-rules Specification

## Purpose
Define the five wagering decisions, reference rules and terminal audit trail.

## Requirements

### Requirement: Supported operations
The processor SHALL support BET debit, WIN credit, LOSS with zero value, full REFUND of BET, and full ROLLBACK of BET, WIN or REFUND. It SHALL reject externally submitted OPENING.

#### Scenario: Five operation types
- **WHEN** valid operations of each supported kind are submitted
- **THEN** their balance and ledger effects follow the operation type

#### Scenario: External opening
- **WHEN** a caller submits kind OPENING
- **THEN** contract validation rejects it

### Requirement: Reference identity and reversal uniqueness
References SHALL use the provider namespace and match player, wallet, currency and round. They SHALL be processed, of an allowed kind, and reversed for their full amount. PostgreSQL SHALL enforce one processed reversal per reference and reversal kind.

#### Scenario: Duplicate refund
- **WHEN** two different REFUND operations concurrently target the same BET
- **THEN** at most one credits the wallet and the other is rejected with ALREADY_REVERSED

#### Scenario: Distinct reversal kinds
- **WHEN** a BET already has a REFUND and receives its first valid ROLLBACK
- **THEN** uniqueness by reference and kind allows the ROLLBACK subject to other rules

#### Scenario: Unsafe credit reversal
- **WHEN** a ROLLBACK would debit more than the available balance
- **THEN** the operation is rejected with REVERSAL_INSUFFICIENT_FUNDS

### Requirement: Durable terminal decisions
PROCESSED, REJECTED and FAILED decisions SHALL be immutable. Rejected operations SHALL retain stable failure codes and SHALL NOT move money.

#### Scenario: Terminal transition
- **WHEN** a terminal transaction is asked to transition again
- **THEN** the domain or database rejects the mutation

## Verification references

src/domain/wager.ts; src/application/process-wager.ts; tests/unit/domain.test.ts; tests/integration/system.test.ts
