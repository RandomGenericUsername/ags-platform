---
id: REQ-004
title: "Uniform icon contract + single manifest owner"
kind: requirement
status: done
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

Source: spine **AD-7**, **AD-21**; doc 101 §13.3; sweep evidence (build-time vs runtime manifest read). Execution: dotfiles-v3 change `uniform-icon-contract` (merged at `d00c3932`).

## Acceptance

- [x] No widget resolves an icon by direct variant outside the state-key path (audio + battery migrated to `iconByStateKey`; `icon-state-keys.test.ts`, 7 tests). ✅
- [x] `bar_mappings` covers the migrated groups (`volume`, `microphone`, `power-mode`); a missing key blanks, never crashes (unit test). ✅
- [x] Exactly one manifest artifact with `schemaVersion`; `IconProvider.barMappings` reads only groups (reserved key separated); `make icons-json-drift` passes. ✅
- [x] Gates green: `make ags-test` (97), `make ags-typecheck` PASS, `make bar-typecheck` OK, `make gates-ci` exit 0. ✅
