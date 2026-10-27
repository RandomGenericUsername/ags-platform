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

## App contract helpers

Every standalone AGS app ships `app.manifest.json` and, when `mode: live`, answers the
`palette-refresh` request. The platform carries the app-side seam for both, plus the
template-conformance gate (spine AD-26/AD-27/AD-33/AD-34; contracts REQ-009):

```ts
import {
  createPaletteRefreshHandler,
  type AgsAppManifest,
} from "ags-platform"

const manifest: AgsAppManifest = {
  schemaVersion: 1,
  app: "clipboard",
  instance: "clipboard",
  configDir: "ags-clipboard",
  mode: "live",
  holdsUnsavedState: false,
}

app.start({
  requestHandler: createPaletteRefreshHandler((appearanceHash) => {
    if (appearanceHash === appliedHash) return { status: "applied" }
    if (busyWithUserWork) return { status: "deferred", reason: "unsaved edits" }
    theme.apply()
    appliedHash = appearanceHash
    return { status: "applied" }
  }),
})
```

- `AgsAppManifest` + `validateAgsAppManifest` mirror the contracts schema: `schemaVersion: 1`,
  `app`/`instance`/`configDir` are one lowercase path segment, and `mode: restart` is invalid with
  `holdsUnsavedState: true`.
- `createPaletteRefreshHandler(refresh)` validates argv, calls the refresh once, and writes exactly
  one JSON-encoded string: `{"ok":true}`, `{"ok":true,"deferred":"..."}` or
  `{"ok":false,"error":"...","retryable":bool}`. A concurrent request gets `busy`; throws/rejections
  become retryable failures; malformed requests and invalid result objects become terminal failures.
  The helper never answers `ok:true` before the refresh has completed and never schedules follow-up
  work itself.
- `checkAppRepo(reader)` (`ags-platform/conformance/app-conformance` for the Node adapter) validates
  the app template: required files, manifest shape/identity fields, a live handler in app source,
  tests and the ticket flow. The deployed identity equality is runtime-owned.

App repos can use the conformance CLI in their own gate:

```bash
node node_modules/ags-platform/conformance/check.ts .
```

## Gates

```bash
make test             # pure-module unit tests (node --test, stock runner)
make exports          # package/export boundary gate (stock runner)
make typecheck-tests  # typecheck the pure test suite (stock runner)
make typecheck        # LOCAL only: needs the desktop stack/GIR declarations
```

CI runs `make test` + `make exports` + `make typecheck-tests` on a stock runner;
`make typecheck` is the documented local gate (no self-hosted runner).

## Tooling

- **BMAD-METHOD:** `.agents/skills/`.
- **OpenSpec:** `openspec/` — `/opsx-propose`.
- **Tickets:** `tickets/` — route with `/triage`.
- **Worktrees:** `scripts/worktree-guard.sh create <id> <slug>`; never work on `main`.
