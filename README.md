# ags-platform

Reusable AGS platform: ports + shared adapters + the event-contract client.

The seams every AGS app builds on. Design of record: `dotfiles-v3:docs/101-ags-platform-architecture.md`.

## Ports

`IconProvider` · `EventSource`/`EventHub` · `LayoutProvider` · `Surface{Spec,Registry}` + `PopupHost` · `Notifier` · `Preferences` · `BarContext`.

## Consumers

`ags-apps` (bar first), plus any AGS app that wants shared icons / events / preferences / notifications. Depends on `contracts`.

## Tooling here

- **BMAD-METHOD:** `.agents/skills/`.
- **OpenSpec:** `openspec/` — `/opsx-propose`.
- **Tickets:** `tickets/` — route with `/triage`.

## Status

Scaffold. Next: extract the ports + adapters from `dotfiles-v3` **in-place** (gates green), then publish here.
