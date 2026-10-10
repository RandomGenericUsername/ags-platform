---
id: REQ-003
title: "Reactive domain read models"
kind: requirement
status: proposed
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

Source: spine **AD-2**, **AD-3**; doc 101 §13.2.

## Acceptance

- [ ] Each read model is an injectable adapter returning a reactive accessor (unit test with a fake device).
- [ ] No domain service is carried in `BarContext`.
- [ ] The network read model matches the prototype's behavior (fixture test).
