## ADDED Requirements

### Requirement: Complete financial console
The dashboard SHALL expose overview by currency, wallet creation/search/detail, the five wagering kinds, transaction filters/detail, stable ledger navigation, read-only reconciliation, service health and local metrics.

#### Scenario: Wallet to reconciliation
- **WHEN** a user opens a wallet, sends a BET and inspects the statement
- **THEN** balance and ledger reflect the committed operation and reconciliation reports the reconstructed amount

#### Scenario: Currency and filters
- **WHEN** a user changes currency, status or kind
- **THEN** queries use the selected scope and pagination restarts for changed filters

### Requirement: Safe submission recovery
Before the first financial POST, the UI SHALL persist its exact body and key in sessionStorage. Uncertain responses SHALL preserve that draft for retry/reload, and switching operations SHALL be disabled while sending. A durable pending response SHALL allow a new operation.

#### Scenario: Outage and reload
- **WHEN** PostgreSQL is unavailable during a submission and the page is reloaded
- **THEN** the form retains its original key/body and retries without inventing a second identity

#### Scenario: Submit missing reference
- **WHEN** a REFUND is durably pending
- **THEN** the user can start a BET in the same tab and later see the REFUND complete

### Requirement: Honest asynchronous results
Pending polling SHALL schedule after the previous request completes and display transient failures. Reconciliation SHALL clear its previous result before a new attempt. Backend WALLET_EXISTS and EXTERNAL_ID_CONFLICT codes SHALL have readable messages.

#### Scenario: Reconciliation outage
- **WHEN** a successful reconciliation is followed by another attempt while the database is stopped
- **THEN** the UI displays the failure without retaining the old success

#### Scenario: Pending polling outage
- **WHEN** polling loses access to the database
- **THEN** the pending decision remains visible with an error and polling resumes after recovery

### Requirement: Responsive accessible presentation
The console SHALL use native dialogs, keyboard focus/Escape, mobile navigation and independently scrolling tables. Financial formatting SHALL remain string-based.

#### Scenario: Mobile statement
- **WHEN** the console is used at 390 by 844 CSS pixels
- **THEN** page content does not overflow horizontally and the statement can scroll inside its container

## Verification references

frontend/src/{main,forms,components}.tsx; frontend/src/{api.ts,styles.css}; tests/unit/frontend.test.ts; tests/integration/system.test.ts; browser inspection on 2026-11-16
