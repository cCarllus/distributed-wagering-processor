## Context

GitHub Markdown strips custom CSS and interactive controls. The repository already contains a private implementation, screenshots and an OpenSpec baseline. The integration suite intentionally stops the Compose PostgreSQL service, so generic Actions service containers do not reproduce its lifecycle.

## Decisions

Use linked local SVG cards with descriptive alternate text for topic navigation. Each reading page has a compact numbered index plus previous/next links. Keep detailed architecture and specs at their established paths and place examples under `guide/`; do not restore the removed docs or evidence folders.

Use one Ubuntu job, official actions pinned by commit SHA and Bun 1.3.14. Install the frozen lockfile without package lifecycle scripts. Run the existing Compose services and the full Bun suite sequentially. Shell pipefail preserves test failures when tee records output. Always collect diagnostics before cleaning up this job's containers. Upload only explicit build/report paths with limited retention.

Grant only contents:read, disable persisted checkout credentials and use pull_request instead of pull_request_target. No custom repository secrets, real AWS resources, deployment credentials or internet-facing demo are needed.

## Validation

Check local document targets, lint, typecheck, build, full unit/integration suite and OpenSpec strict validation. Then inspect the actual GitHub run and the rendered navigation. Local verification and hosted CI results must remain distinct.
