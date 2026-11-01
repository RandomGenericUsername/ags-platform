# ags-platform

Reusable AGS platform: ports, shared adapters, the event-contract client, and the
standalone-app contract helpers.

The seams every AGS app builds on. Design of record:
`dotfiles-v3:docs/101-ags-platform-architecture.md`.

## Ports

`IconProvider` · `EventSource`/`EventHub` · `LayoutProvider` · `Surface{Spec,Registry}` +
`PopupHost` · `Notifier` · `Preferences` · `BarContext`.

## Consumers

`ags-apps` (bar + the sibling apps), plus any AGS app that wants shared icons/events/preferences/
notifications. The platform depends on `contracts`; it never depends on an app.

## Releases

Current release: **`v0.4.0`** — the Theme provider role API
(`palette()` + `subscribe()`), one composed CSS provider, and the app
manifest/palette-refresh/conformance helpers from v0.3.0. See
[`CHANGELOG.md`](./CHANGELOG.md).

The package stays `private` and `package.json` keeps the historical `0.0.0`;
the annotated git tag is the release identity. `ags-apps` pins
`AGS_PLATFORM_VERSION` in its `Makefile`; re-pinning is a consumer repo change.

## Workspace

Developed beside its consumers under `~/Development/dotfiles/`. The canonical ownership/pin map
is [`../dotfiles-v3/docs/WORKSPACE.md`](../dotfiles-v3/docs/WORKSPACE.md).

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

## Theme

One mechanism per app: one `Gio.FileMonitor`, one composed `Gtk.CssProvider`.

```ts
import { theme } from "ags-platform"

theme.apply()                          // install the palette now
const palette = theme.palette()        // { version: "1", roles: { primary: "#…", … } }
const unsubscribe = theme.subscribe((next) => {
  // `next` is already loaded AND applied; read it directly.
  render(next.roles.on_surface)
})
// later
unsubscribe()                          // stops the monitor when the last listener leaves
```

- `theme.palette()` parses the runtime's `current/colors.yaml` without a YAML
  dependency. It accepts the machine-generated flat shape (`role: "#hex"`,
  quoted or unquoted, with comments), ignores the legacy `colors:` list, keeps
  additive producer roles, and fails closed with `PaletteParseError` (source +
  line) on malformed input. `subscribe()` is change-only: read `palette()` for
  the initial value.
- `theme.subscribe(listener)` shares ONE monitor across listeners, reloads the
  palette, re-applies the CSS, then notifies. The last unsubscribe stops the
  monitor. A malformed refresh keeps the previous palette/provider installed
  and reports through `onError`.
- The provider carries the legacy `colors.css` content **verbatim** and appends
  one `@define-color <role> <hex>;` per declared role. Every current
  `@color_*` app is therefore unchanged through Phase A; migrated apps may use
  the role directly:
  ```css
  .card     { color: @on_surface; background: @surface_container; }
  .floating { color: @on_backdrop; }
  ```
  `paletteCssVariable("primary")` returns the `@primary` reference for code
  that builds CSS strings.
- `createReplacingCssSink(host)` keeps exactly one provider per app: each apply
  adds the next provider before removing the previous one and only removes the
  handle it added. The app stylesheet and GTK theme are untouched (BUG-001).
- The exports are `PALETTE_V1_ROLES`, `PALETTE_VERSION`, `parsePaletteYaml`,
  `renderPaletteCss`, `paletteCssVariable`, `missingPaletteRoles`,
  `composeThemeCss`, `createTheme`, `createReplacingCssSink` and the
  `Palette`/`Theme`/`ThemeOptions`/`CssSink`/`CssProvider*` types.
- Phase B (kit + per-app role migration, including btop-theme-studio and icme)
  is a separate ticket; the legacy aliases are not removed here.

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
