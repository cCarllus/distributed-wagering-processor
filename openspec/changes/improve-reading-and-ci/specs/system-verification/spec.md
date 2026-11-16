## ADDED Requirements

### Requirement: Hosted continuous integration
GitHub Actions SHALL run documentation checks, lint, typecheck, build and the complete Bun suite on pushes to main, pull requests and manual dispatch. The suite SHALL use the project's Compose PostgreSQL and LocalStack services, with no integration skips. Workflow actions and Bun SHALL be pinned. The workflow SHALL preserve failing command exit codes, collect diagnostic reports, clean up its containers and publish compiled artifacts only after successful validation. It SHALL require no custom secrets or deployment permissions.

#### Scenario: Change reaches GitHub
- **WHEN** a push or pull request triggers the workflow
- **THEN** the tested commit receives the actual validation result, including failures caused by missing infrastructure

#### Scenario: Integration failure
- **WHEN** a test fails while its output is recorded
- **THEN** the job fails, diagnostic collection runs before cleanup and no successful build artifact is published

## Verification references

.github/workflows/ci.yml; package.json; compose.yaml; tests/integration/system.test.ts; guide/testes.md
