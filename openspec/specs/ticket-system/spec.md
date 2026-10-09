# ticket-system Specification

## Purpose

The ticket system is the project's own work index: it classifies every work item by kind, tracks its lifecycle, and links to wherever detail lives (BMAD artifacts, OpenSpec changes), so nothing is tracked in two formats with no shared view.

## Requirements

### Requirement: Fixed kind vocabulary

Every item SHALL declare exactly one `kind:` from the fixed set `epic | requirement | bug | ops-task | spike | task`. No other kinds are valid. `ops-task` MAY be read as `chore` (Shortcut mapping); the file MUST still declare `ops-task`.

#### Scenario: Unknown kind rejected

- **WHEN** an item file declares a `kind:` outside the fixed set
- **THEN** validation fails naming the file and the allowed set

### Requirement: Epic is a container only

An `epic` item SHALL list `children:` (item ids) and `done-when:` and SHALL NOT link execution artifacts (no OpenSpec change, no build plan) directly.

#### Scenario: Epic completion rolls up

- **WHEN** all children of an epic reach done and its `done-when` holds
- **THEN** the epic may be marked done; otherwise marking done is rejected

### Requirement: Bug requires repro

A `bug` item SHALL contain `repro:` (exact command), `observed:` and `expected:` outputs. A bug without all three SHALL be rejected outright with no parking state.

#### Scenario: Valid bug accepted

- **WHEN** a bug carries repro command plus observed and expected outputs
- **THEN** it enters triage sizing with severity recorded

### Requirement: Spike carries per-spike box and questions

A `spike` item SHALL declare `timebox:` (set per spike at triage) and `questions:` (named questions to answer). It SHALL stop at the box and report `answered:` / `open:` findings; implementation output from a spike is a failure.

#### Scenario: Box expiry reports

- **WHEN** the timebox is reached with questions still open
- **THEN** the spike reports findings so far with open questions listed, and no second box starts without explicit user call

### Requirement: Task is a child unit

A `task` item SHALL declare a `parent:` holding a story or epic id, and SHALL inherit its lane from the parent (`lane: inherits`). A `task` without a parent SHALL be rejected at validation. An `ops-task` SHALL NOT declare a parent — same body shape, opposite parent rule keeps the kinds disjoint.

#### Scenario: Parentless task rejected

- **WHEN** validation encounters a `task` item with empty `parent:`
- **THEN** it fails naming the file, regardless of all other fields

### Requirement: Global index mirrors hierarchy

`tickets/INDEX.md` SHALL list epics with their children plus standalone items grouped by kind, each entry linking to its item file and its execution links.

#### Scenario: Index completeness

- **WHEN** validation runs
- **THEN** every item file under `tickets/` appears in INDEX.md and every INDEX entry resolves to an existing file

### Requirement: Index entries carry link, title, status, rollup

Every INDEX.md entry SHALL contain, in order: a relative link to the item file, the item title, the current `status`, and the execution links (OpenSpec change names and/or BMAD artifact paths, or `none`). Epic entries SHALL additionally show children rollup as `done/total children done`, the one-line `done-when`, and one nested line per child with its own link, title, and status. Bug entries SHALL additionally show severity; spike entries SHALL additionally show timebox state (`boxed <limit>` | `reported`).

#### Scenario: Epic rollup line

- **WHEN** an epic has 3 of 7 children done
- **THEN** its INDEX line reads `| \`in-progress\` | 3/7 children done` with 7 nested child lines each carrying link, title, status

#### Scenario: Stale index rejected

- **WHEN** an item's status changes without its INDEX line changing
- **THEN** the completeness check fails naming the diverged entry
