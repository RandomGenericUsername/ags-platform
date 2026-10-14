# Ticket index

> Counting rule: completeness checks cover item files (`tickets/<id>-<slug>/ticket.md`) only.
> `tickets/_template/` (and any `tickets/_fixtures/`) are excluded from INDEX completeness counting.
> Entry format: link — title | `status` | execution links. Epics add `done/total children done`, done-when, and one nested line per child. Bugs add severity. Spikes add timebox state.

## Active epics

- [EPIC-001-extract-and-publish-platform/ticket.md](./EPIC-001-extract-and-publish-platform/ticket.md) — Extract and publish the AGS platform | `in-progress` | links: none | 2/10 children done
  - done-when: ags-platform carries the platform ports + shared adapters + the one event client, extracted in-place in dotfiles-v3 with all gates green, then published with CI; apps depend only on it.
  - [REQ-001-harden-extraction-gates/ticket.md](./REQ-001-harden-extraction-gates/ticket.md) — Harden the typecheck gates before extraction | `done` | openspec: harden-extraction-gates
  - [REQ-002-kit-shell-four-shapes/ticket.md](./REQ-002-kit-shell-four-shapes/ticket.md) — Kit completeness + Shell + four widget shapes | `done` | openspec: kit-shell-four-shapes
  - [REQ-003-reactive-domain-read-models/ticket.md](./REQ-003-reactive-domain-read-models/ticket.md) — Reactive domain read models | `proposed` | openspec: reactive-domain-read-models
  - [REQ-004-uniform-icon-contract/ticket.md](./REQ-004-uniform-icon-contract/ticket.md) — Uniform icon contract + single manifest owner | `proposed` | openspec: uniform-icon-contract
  - [REQ-005-one-event-client/ticket.md](./REQ-005-one-event-client/ticket.md) — One event client (hub + job control + mandatory restart contract) | `proposed` | openspec: one-event-client
  - [REQ-006-surfaces-popup-host/ticket.md](./REQ-006-surfaces-popup-host/ticket.md) — Surfaces + PopupHost | `proposed` | openspec: surfaces-popup-host
  - [REQ-007-preferences-notifier-theme/ticket.md](./REQ-007-preferences-notifier-theme/ticket.md) — Preferences + Notifier + Theme ports | `proposed` | openspec: preferences-notifier-theme
  - [REQ-008-migrate-widgets-to-shapes/ticket.md](./REQ-008-migrate-widgets-to-shapes/ticket.md) — Migrate the bar widgets onto the shapes | `proposed` | openspec: migrate-widgets-to-shapes
  - [REQ-009-extract-platform-in-place/ticket.md](./REQ-009-extract-platform-in-place/ticket.md) — Extract the platform in-place in dotfiles-v3 | `proposed` | openspec: extract-platform-in-place
  - [REQ-010-publish-ags-platform/ticket.md](./REQ-010-publish-ags-platform/ticket.md) — Publish ags-platform + CI | `proposed` | openspec: publish-ags-platform

## Requirements

(none)

## Bugs

(none)

## Ops tasks

(none)

## Spikes

(none)

## Tasks

(none)

## Done (links only, newest last)

(none)
