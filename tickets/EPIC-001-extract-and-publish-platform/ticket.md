---
id: EPIC-001
title: "Extract and publish the AGS platform"
kind: epic
status: done
lane: bmad-advisory
links:
  openspec: none
  bmad: none
worktree: .worktrees/EPIC-001/
branch: ticket/EPIC-001-extract-and-publish-platform
children: [REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010]
done-when: "ags-platform carries the platform ports + shared adapters + the one event client, extracted in-place in dotfiles-v3 with all gates green, then published with CI; apps depend only on it."
---

# Extract and publish the AGS platform

## Done-when

`ags-platform` carries the platform ports + shared adapters + the one event client, **extracted in-place in `dotfiles-v3` with all gates green**, then published with CI. Apps depend only on it.

Governed by spine **AD-1** (dependency direction), **AD-2** (injected context), **AD-4** (frozen port surface), **AD-17** (distribution), **AD-19** (gate discipline), **AD-20** (sequenced migration).

## Children

- [x] `REQ-{i:03d}` — Harden the typecheck gates before extraction (`done`)
- [x] `REQ-{i:03d}` — Kit completeness + Shell + four widget shapes (`done`)
- [x] `REQ-{i:03d}` — Reactive domain read models (`done`)
- [x] `REQ-{i:03d}` — Uniform icon contract + single manifest owner (`done`)
- [x] `REQ-{i:03d}` — One event client (`done`)
- [x] `REQ-{i:03d}` — Surfaces + PopupHost (`done`)
- [x] `REQ-{i:03d}` — Preferences + Notifier + Theme ports (`done`)
- [x] `REQ-{i:03d}` — Migrate the bar widgets onto the shapes (`done`)
- [x] `REQ-{i:03d}` — Extract the platform in-place in dotfiles-v3 (`done`)
- [x] `REQ-{i:03d}` — Publish ags-platform + CI (`done`)
