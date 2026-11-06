# Ticket index

> Counting rule: completeness checks cover item files (`tickets/<id>-<slug>/ticket.md`) only.
> `tickets/_template/` (and any `tickets/_fixtures/`) are excluded from INDEX completeness counting.
> Entry format: link — title | `status` | execution links. Epics add `done/total children done`, done-when, and one nested line per child. Bugs add severity. Spikes add timebox state.

## Active epics

- [EPIC-001-extract-and-publish-platform/ticket.md](./EPIC-001-extract-and-publish-platform/ticket.md) — Extract and publish the AGS platform | `done` | links: none | 10/10 children done
  - done-when: ags-platform carries the platform ports + shared adapters + the one event client, extracted in-place in dotfiles-v3 with all gates green, then published with CI; apps depend only on it.
  - [REQ-001-harden-extraction-gates/ticket.md](./REQ-001-harden-extraction-gates/ticket.md) — Harden the typecheck gates before extraction | `done` | openspec: harden-extraction-gates
  - [REQ-002-kit-shell-four-shapes/ticket.md](./REQ-002-kit-shell-four-shapes/ticket.md) — Kit completeness + Shell + four widget shapes | `done` | openspec: kit-shell-four-shapes
  - [REQ-003-reactive-domain-read-models/ticket.md](./REQ-003-reactive-domain-read-models/ticket.md) — Reactive domain read models | `done` | openspec: reactive-domain-read-models
  - [REQ-004-uniform-icon-contract/ticket.md](./REQ-004-uniform-icon-contract/ticket.md) — Uniform icon contract + single manifest owner | `done` | openspec: uniform-icon-contract
  - [REQ-005-one-event-client/ticket.md](./REQ-005-one-event-client/ticket.md) — One event client (hub + job control + mandatory restart contract) | `done` | openspec: one-event-client
  - [REQ-006-surfaces-popup-host/ticket.md](./REQ-006-surfaces-popup-host/ticket.md) — Surfaces + PopupHost | `done` | openspec: surfaces-popup-host
  - [REQ-007-preferences-notifier-theme/ticket.md](./REQ-007-preferences-notifier-theme/ticket.md) — Preferences + Notifier + Theme ports | `done` | openspec: preferences-notifier-theme
  - [REQ-008-migrate-widgets-to-shapes/ticket.md](./REQ-008-migrate-widgets-to-shapes/ticket.md) — Migrate the bar widgets onto the shapes | `done` | openspec: migrate-widgets-to-shapes
  - [REQ-009-extract-platform-in-place/ticket.md](./REQ-009-extract-platform-in-place/ticket.md) — Extract the platform in-place in dotfiles-v3 | `done` | openspec: extract-platform-in-place
  - [REQ-010-publish-ags-platform/ticket.md](./REQ-010-publish-ags-platform/ticket.md) — Publish ags-platform + CI | `done` | openspec: publish-ags-platform

## Requirements

- [REQ-011-overlay-lifecycle/ticket.md](./REQ-011-overlay-lifecycle/ticket.md) — Overlay lifecycle primitive (present-first, defer-heavy, skip-when-unchanged) | `in-progress` | links: none
- [REQ-012-ags-app-manifest-helper/ticket.md](./REQ-012-ags-app-manifest-helper/ticket.md) — AGS app manifest helper, palette-refresh handler helper and template conformance | `done` | links: none
- [REQ-013-theme-provider-roles/ticket.md](./REQ-013-theme-provider-roles/ticket.md) — Theme provider: `palette.v1` role API + change subscription | `done` | tag: v0.4.0 (Phase A); Phase B complete per Outcome
- [REQ-014-skin-port-adapter/ticket.md](./REQ-014-skin-port-adapter/ticket.md) — Skin port + adapter: composed skin CSS, reactive tokens, USER priority | `done` | tag: v0.6.0
- [REQ-015-skin-token-validation/ticket.md](./REQ-015-skin-token-validation/ticket.md) — Skin token validation: per-token kinds for the frozen v0.6.0 vocabulary | `in-progress` | links: none

## Bugs

- [BUG-001-theme-provider-accumulation/ticket.md](./BUG-001-theme-provider-accumulation/ticket.md) — Theme adapter adds a CSS provider per refresh instead of replacing one | `done` | severity: medium

## Ops tasks

- [OPS-001-index-status-sync](./OPS-001-index-status-sync/ticket.md) — Sync REQ-013 INDEX status with the shipped v0.4.0 tag | `done` | worktree: .worktrees/OPS-001/ | branch: ticket/OPS-001-index-status-sync

## Spikes

(none)

## Tasks

(none)

## Done (links only, newest last)

(none)
