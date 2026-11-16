## ADDED Requirements

### Requirement: Topic and sequential navigation
The README SHALL offer six descriptive linked SVG buttons for setup, API, dashboard, architecture, validation and specifications. The six reading pages SHALL provide numbered navigation and previous/next links where applicable. Local images and page destinations SHALL exist. Detailed contracts and local-only limitations SHALL remain accessible.

#### Scenario: Reviewer chooses a topic
- **WHEN** a reviewer follows a topic button in the README
- **THEN** the matching Markdown page opens and provides a route back to the index or to adjacent topics

#### Scenario: Local documentation target disappears
- **WHEN** a local linked file or image is missing
- **THEN** the documentation check fails and identifies its referring file

## Verification references

README.md; guide/; ARCHITECTURE.md; openspec/README.md; assets/navigation/; scripts/check-docs.ts; GitHub rendered-page inspection
