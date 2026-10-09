# task-router Specification

## Purpose

The task router sizes each item and sends it down the cheapest safe lane, asking the user explicitly when classification or size is ambiguous, and calling BMAD specialists for advice without ever forcing them.

## Requirements

### Requirement: Kind first, size second

The router SHALL classify `kind` before sizing. A small epic SHALL still decompose (never build); a large bug SHALL still follow the bug lane (repro, fix, regression test).

#### Scenario: Epic-shaped small request

- **WHEN** triage receives a small but multi-part request
- **THEN** it proposes an epic with children, not a single build

### Requirement: Lane rubric

The router SHALL map (kind, size, uncertainty) to lanes: XS → direct or single OpenSpec change; single bounded feature → one OpenSpec change; multi-part understood → one item + N changes, no BMAD; broad/uncertain/architectural → BMAD specialist advisory first, then spec, then changes.

#### Scenario: BMAD-overkill lane

- **WHEN** work is multi-part but fully understood with no architectural unknowns
- **THEN** the router SHALL NOT invoke BMAD and SHALL plan one item plus N OpenSpec changes

### Requirement: Explicit ask on ambiguity

When classification or size is ambiguous, the router SHALL ask the user explicitly (chosen options + recommendation) instead of assuming.

#### Scenario: Ambiguous size

- **WHEN** a request could be one change or several
- **THEN** triage stops and asks before writing any item or change

### Requirement: BMAD advisory, user selects

For epics and uncertain work the router SHALL recommend BMAD vs plain split with reasons, and the user selects. BMAD advice SHALL never auto-execute implementation.

#### Scenario: Plain split selected

- **WHEN** the user selects plain decomposition over BMAD
- **THEN** the router writes the epic with children and no BMAD artifacts are required

### Requirement: Task lane inherits parent

A `task` item SHALL NOT be routed to `bmad-advisory` on its own; its lane is the parent's lane. Decomposing a parent into tasks SHALL NOT change any lane.

#### Scenario: Task under BMAD-advised epic

- **WHEN** a task's parent routed through BMAD advisory
- **THEN** the task inherits the resulting lane and carries no BMAD artifacts of its own
