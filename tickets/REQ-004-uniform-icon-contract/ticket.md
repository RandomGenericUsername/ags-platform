---
id: REQ-004
title: "Uniform icon contract + single manifest owner"
kind: requirement
status: proposed
lane: 2
links:
  openspec: uniform-icon-contract
  bmad: none
worktree: none
branch: none
---

# Uniform icon contract + single manifest owner

## Requirement

Every icon follows the network pattern: code emits a **state key**; data maps key → variant → art. Migrate the two leaks (audio `volume`/`microphone`, battery `power-mode`) to `iconByStateKey` and add their `bar_mappings`. Establish **one icon manifest, one owner, one shape**: the bar's build-time import is a bundling detail of the same artifact, and the single manifest carries `schemaVersion`.

Source: spine **AD-7**, **AD-21**; doc 101 §13.3; sweep evidence (build-time vs runtime manifest read).

## Acceptance

- [ ] No widget resolves an icon by direct variant outside the state-key path (grep + review).
- [ ] `bar_mappings` covers the migrated groups; a missing key blanks, never crashes.
- [ ] Exactly one manifest artifact exists with a `schemaVersion`; `IconProvider.barMappings` reads only it.
