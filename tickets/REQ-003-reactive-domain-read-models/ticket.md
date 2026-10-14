---
id: REQ-003
title: "Reactive domain read models"
kind: requirement
status: done
lane: 2
links:
  openspec: reactive-domain-read-models
  bmad: none
worktree: none
branch: none
---

# Reactive domain read models

## Requirement

Extract reactive read models for network, battery, bluetooth, and audio as Astal adapters under the app's `domains/` (the prototype's `domains/network/read-model.ts` is the seed; the audio hexagon is the model domain). They are app-level **domain services**, closed over at registration, not carried in `BarContext`.

Source: spine **AD-2**, **AD-3**; doc 101 §13.2. Execution: dotfiles-v3 change `reactive-domain-read-models` (merged at `747e68a2`).

## Acceptance

- [x] Each read model is an injectable adapter returning a reactive accessor (`domains/{network,battery,bluetooth,audio}/read-model.ts` + `astal.ts`; 4 fake-device suites, 15 tests). ✅
- [x] No domain service is carried in `BarContext` (the read models take the reactive primitive as a parameter; the AGS binding lives in `domains/astal.ts`). ✅
- [x] The network read model matches the prototype's behavior (`domains/network/read-model.ts` made pure; wired into `network-descriptor.tsx`). ✅
- [x] Gates green: `make ags-test` (90), `make ags-typecheck` PASS, `make bar-typecheck` OK, `make gates-ci` exit 0. ✅
