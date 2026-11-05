---
id: OPS-001
title: "Sync REQ-013 INDEX status with the shipped v0.4.0 tag"
kind: ops-task
status: done
lane: direct
links:
  openspec: none
  bmad: none
worktree: .worktrees/OPS-001/
branch: ticket/OPS-001-index-status-sync
---

# Sync REQ-013 INDEX status with the shipped v0.4.0 tag

## Work

`REQ-013-theme-provider-roles` is `done` and the Phase A `v0.4.0` tag exists,
but `tickets/INDEX.md` still said `in-progress` and the Phase A tag box was
unchecked. Update the index to `done` with the tag, and tick the tag item.

The Phase B follow-up boxes stay unchecked on purpose: the ticket says they are
tracked by the follow-up migration tickets, not by this branch. The Outcome
section records Phase B as complete.

## Done-when

The REQ-013 INDEX line and the Phase A acceptance reflect the shipped `v0.4.0`
tag.

## Evidence

- `git tag --sort=-creatordate` → `v0.4.0` present.
- `tickets/REQ-013-theme-provider-roles/ticket.md` — Outcome.
- `tickets/INDEX.md` — `done`, `tag: v0.4.0 (Phase A)`.
