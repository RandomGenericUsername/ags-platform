---
id: REQ-001
title: "Harden the typecheck gates before extraction"
kind: requirement
status: proposed
lane: 2
links:
  openspec: harden-extraction-gates
  bmad: none
worktree: none
branch: none
---

# Harden the typecheck gates before extraction

## Requirement

Before any extraction, `bar-typecheck` and `ags-typecheck` must cover the extracted surface and run in `gates-ci`, and the per-app drift/symbol suites must run in the root gate. Today `bar-typecheck`/`ags-typecheck`/`capture-typecheck` are excluded from `gates-ci`, `ags-typecheck` only fails under `dotfiles/config/ags/audio/`, and `ags-typecheck` runs only on a self-hosted CI job — so a bad extraction can pass CI.

Source: spine **AD-19**; sweep evidence (`Makefile:58`, `scripts/ags-typecheck.py:91`, `.github/workflows/gates.yml:339-348`).

## Acceptance

- [ ] `make gates-ci` runs `bar-typecheck` and `ags-typecheck` (command: `make -n gates-ci | grep -E 'bar-typecheck|ags-typecheck'` → both present).
- [ ] A deliberate type error in a non-audio bar file fails `ags-typecheck` (negative test).
- [ ] The per-app `event-contract-drift`/symbol suites run from the root gate.
