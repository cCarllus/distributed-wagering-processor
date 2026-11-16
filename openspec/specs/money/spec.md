# money Specification

## Purpose
Represent monetary values exactly across domain, PostgreSQL and HTTP.

## Requirements

### Requirement: Exact fixed-scale representation
The system SHALL represent money as bigint cents internally and decimal strings with exactly two fractional digits in HTTP contracts. It SHALL accept BRL, USD and EUR up to 99999999999999.99 without implicit rounding.

#### Scenario: Reject extra precision
- **WHEN** an input contains 1.001, a JSON number, an exponent or an unsupported currency
- **THEN** validation rejects it before a financial effect is written

#### Scenario: Preserve large values
- **WHEN** a valid amount exceeds the safe integer range of JavaScript number in cents
- **THEN** arithmetic, persistence and formatting preserve every cent

### Requirement: Encapsulated arithmetic
Money SHALL be immutable, validate its range during construction and rehydration, and reject arithmetic between currencies.

#### Scenario: Different currencies
- **WHEN** BRL is combined with USD
- **THEN** the domain rejects the operation and neither value changes

## Verification references

src/domain/money.ts; src/application/contracts.ts; tests/unit/domain.test.ts; tests/unit/frontend.test.ts
