# ags-platform

Reusable AGS platform: ports, shared adapters, and the event-contract client.

The seams every AGS app builds on. Design of record:
`dotfiles-v3:docs/101-ags-platform-architecture.md`.

## Ports

`IconProvider` · `EventSource`/`EventHub` · `LayoutProvider` · `Surface{Spec,Registry}` +
`PopupHost` · `Notifier` · `Preferences` · `BarContext`.

## Consumers

`ags-apps` (bar + the sibling apps), plus any AGS app that wants shared icons/events/preferences/
notifications. The platform depends on `contracts`; it never depends on an app.

## Workspace

Developed beside its consumers under `~/Development/dotfiles/`. The canonical ownership/pin map
is [`../dotfiles-v3/docs/WORKSPACE.md`](../dotfiles-v3/docs/WORKSPACE.md). `ags-apps` pins this
unit at `v0.2.0` (`AGS_PLATFORM_VERSION` in its `Makefile`).

## Gates

```bash
make test             # pure-module unit tests (node --test, stock runner)
make typecheck-tests  # typecheck the pure test suite (stock runner)
make typecheck        # LOCAL only: needs the desktop stack/GIR declarations
```

CI runs only `make test` + `make typecheck-tests` on a stock runner; `make typecheck` is the
documented local gate (no self-hosted runner).

## Tooling

- **BMAD-METHOD:** `.agents/skills/`.
- **OpenSpec:** `openspec/` — `/opsx-propose`.
- **Tickets:** `tickets/` — route with `/triage`.
- **Worktrees:** `scripts/worktree-guard.sh create <id> <slug>`; never work on `main`.
