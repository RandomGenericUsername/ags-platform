---
id: EPIC-001
title: "Extract and publish the AGS platform"
kind: epic
status: proposed
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

- [ ] `REQ-001` — Harden the typecheck gates before extraction (`proposed`)
- [ ] `REQ-002` — Kit completeness + Shell + four widget shapes (`proposed`)
- [ ] `REQ-003` — Reactive domain read models (`proposed`)
- [ ] `REQ-004` — Uniform icon contract + single manifest owner (`proposed`)
- [ ] `REQ-005` — One event client (`proposed`)
- [ ] `REQ-006` — Surfaces + PopupHost (`proposed`)
- [ ] `REQ-007` — Preferences + Notifier + Theme ports (`proposed`)
- [ ] `REQ-008` — Migrate the bar widgets onto the shapes (`proposed`)
- [ ] `REQ-009` — Extract the platform in-place in dotfiles-v3 (`proposed`)
- [ ] `REQ-010` — Publish ags-platform + CI (`proposed`)
