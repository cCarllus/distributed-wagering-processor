## Why

The README mixes setup, contracts, screenshots and validation in a single long page. Navigation should let a reviewer choose a topic or follow a short reading sequence. Validation currently depends on a developer running commands locally.

## What Changes

- Introduce a compact README with local SVG navigation buttons and six linked reading pages.
- Preserve the technical contracts and limitations while moving examples into focused guides.
- Run documentation checks, lint, typecheck, build and the full container-backed suite in GitHub Actions on pushes, pull requests and manual dispatch.
- Keep compiled output and diagnostic reports as short-lived private workflow artifacts. No application deployment is included.

## Capabilities

### New Capabilities
- `project-documentation`: accessible topic navigation and sequential reading with working local links.

### Modified Capabilities
- `system-verification`: automatically run the existing full validation against real PostgreSQL and local SQS.

## Impact

README, ARCHITECTURE, new guide pages, local SVG assets, a documentation link checker and a GitHub workflow. No financial or dashboard behavior changes. This proposal precedes the work, unlike the retrospective baseline archives.
