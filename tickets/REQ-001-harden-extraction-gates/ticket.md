---
id: REQ-001
title: "Harden the typecheck gates before extraction"
kind: requirement
status: done
lane: 2
links:
  openspec: harden-extraction-gates
  bmad: none
worktree: none
branch: none
---

# Harden the typecheck gates before extraction

## Requirement

Before any extraction, `bar-typecheck` and `ags-typecheck` must cover the extracted surface and run in CI, and the per-app drift/symbol suites must run in the root gate. Today `bar-typecheck`/`ags-typecheck`/`capture-typecheck` are excluded from `gates-ci`, `ags-typecheck` only fails under `dotfiles/config/ags/audio/`, and `ags-typecheck` runs only on a self-hosted CI job — so a bad extraction can pass CI.

Source: spine **AD-19**; sweep evidence (`Makefile:58`, `scripts/ags-typecheck.py:91`, `.github/workflows/gates.yml:339-348`). Execution: dotfiles-v3 change `harden-extraction-gates` (merged at `36be78f4`).

## Acceptance

- [x] `bar-typecheck` and `ags-typecheck` run in **CI** (self-hosted `[self-hosted, linux]` jobs — they need the desktop stack, so they stay out of the stock `gates-ci` by design); `make ci-gates-parity` passes. ✅
- [x] A deliberate type error in a non-audio bar file (`kit/icon.ts`) fails `make ags-typecheck` (exit 2). ✅
- [x] The per-app `event-contract-drift`/symbol suites run from the root gate (`make per-app-drift-symbol-suites` → OK). ✅
- [x] `ags-typecheck`'s watched surface widened from `audio/` to the whole bar tree; `make gates-ci` green. ✅
