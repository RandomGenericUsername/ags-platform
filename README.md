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

Current release: **`v1.0.1`** — Generations v3 consumer (contracts `v0.8.0`)
plus the appearance CSS validator patch: one immutable
`state/generations/<genHash>/`, one watched `state/current` hop, one provider at
USER priority, and generation-bound `appearance-refresh <genHash>` apply/ack.
`validateAppearanceCss` rejects only 3/4/6/8-digit hex colour literals outside
the `@define-color` block, so ID selectors such as
`window#notifications-window` and `url(#fragment)` references pass. The platform
reads only `$XDG_STATE_HOME/dotfiles/current/manifest.json`,
`current/appearance/<configDir>.css` and `current/appearance/tokens.json`; it
never reads the v2 config-link or skin paths. The v2 `palette-refresh` helper
and the v1 `theme`/`skin` aliases remain exported as deprecated migration
helpers. See [`CHANGELOG.md`](./CHANGELOG.md).

The package stays `private` and `package.json` keeps the historical `0.0.0`;
the annotated git tag is the release identity. `ags-apps` pins
`AGS_PLATFORM_VERSION` in its `Makefile`; re-pinning is a consumer repo change.

## Workspace

Developed beside its consumers under `~/Development/dotfiles/`. The canonical ownership/pin map
is [`../dotfiles-v3/docs/WORKSPACE.md`](../dotfiles-v3/docs/WORKSPACE.md).

## App contract helpers

Every standalone AGS app ships `app.manifest.json` and, when `mode: live`, answers the
generation-bound `appearance-refresh <genHash>` request. The platform carries the
app-side seam for both, plus the template-conformance gate (spine
AD-26/AD-27/AD-33/AD-34; contracts REQ-009/REQ-016):

```ts
import {
  createAppearanceRefreshHandler,
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
  requestHandler: createAppearanceRefreshHandler(appearance, () => {
    refreshDerivedSurfaces()   // icons / caches only — never theme.apply()
    return { status: "applied" }
  }),
})
```

- `AgsAppManifest` + `validateAgsAppManifest` mirror the contracts schema: `schemaVersion: 1`,
  `app`/`instance`/`configDir` are one lowercase path segment, and `mode: restart` is invalid with
  `holdsUnsavedState: true`.
- `createAppearanceRefreshHandler(appearance, work?)` validates exactly
  `["appearance-refresh", "<64-hex genHash>"]`, resolves THAT generation, and writes exactly one
  JSON-encoded string: `{"applied":"<genHash>"}`,
  `{"deferred":"reason","genHash":"<genHash>"}` or
  `{"failed":"reason","retryable":bool,"genHash":"<genHash>"}`. A stale pointer or absent
  generation is deferred with the requested hash; `{"ok":true}` is never produced or accepted. A
  concurrent request gets `{"deferred":"busy","genHash":"<genHash>"}`; throws/rejections become
  retryable failures; malformed requests and invalid work objects become terminal failures. The
  helper never answers applied before the apply/work completes and never schedules follow-up work
  itself.
- `createPaletteRefreshHandler(refresh)` remains exported as the **deprecated v2 helper** during
  app migration. It still produces the old `{"ok":true}` family and must not be used with the v3
  `appearance-refresh` transport.
- `checkAppRepo(reader)` (`ags-platform/conformance/app-conformance` for the Node adapter) validates
  the app template: required files, manifest shape/identity fields, a live handler in app source,
  tests and the ticket flow. The deployed identity equality is runtime-owned.

App repos can use the conformance CLI in their own gate:

```bash
node node_modules/ags-platform/conformance/check.ts .
```

## Appearance (Generations v3)

> **One generation, one watched hop, one provider.** Appearance replaces the
> split Theme + Skin pair. The runtime commits palette + skin + mode as one
> immutable `$XDG_STATE_HOME/dotfiles/generations/<genHash>/` directory and
> swaps `state/current` atomically. Every app installs ONE composed
> `Gtk.CssProvider` at `GTK_STYLE_PROVIDER_PRIORITY_USER` = **800**,
> last-installed, and resolves that exact generation.

```ts
import {
  appearance,                 // bar singleton: createAppearance({ configDir: "ags" })
  createAppearance,
  createAppearanceRefreshHandler,
} from "ags-platform"

const appAppearance = createAppearance({ configDir: "ags-clipboard" })
appAppearance.apply()                       // apply the committed generation
// or: appAppearance.applyGeneration(genHash) // apply exactly this generation
appAppearance.appliedHash()                 // exact installed hash, or null

const radius = appAppearance.value("surface.panel.radius", 12)
const width  = appAppearance.value("layout.ags-clipboard.card-width", 360)
// accessor: radius() / radius.peek(); reloads update the cell in place

app.start({
  requestHandler: createAppearanceRefreshHandler(appAppearance, () => {
    refreshDerivedSurfaces()    // icons / caches only — no theme.apply()
    return { status: "applied" }
  }),
})
```

- **Paths.** Watch ONLY `$XDG_STATE_HOME/dotfiles/current`
  (`APPEARANCE_WATCH_PATH`, `APPEARANCE_WATCH_POINTER = "dotfiles/current"`).
  Read `current/manifest.json`, `current/appearance/<configDir>.css` and
  `current/appearance/tokens.json`. There is no
  `$XDG_CONFIG_HOME/<configDir>/appearance.css` read path, no app-tag read and
  no v1/v2 skin read path.
- **Generation-bound apply.** `applyGeneration(genHash)` resolves
  `generations/<genHash>/...` directly when present. A `current` fallback
  verifies `manifest.generationHash` before AND after the artifact read. A
  pointer that moved, a missing generation or a hash mismatch applies nothing
  and returns `deferred`/`failed` with the requested hash. `apply()` resolves
  the committed `current` generation; `appliedHash()` exposes the installed
  one.
- **Tokens.** `tokens.json` is the resolved v2 document wrapped by the v3
  generation: `version: 2` plus the closed groups `surface`, `state`, `type`,
  `ink` and namespaced numeric `layout.<app>`. Lengths are unitless numbers;
  paints are palette role expressions only. `surface.panel.radius` and
  `layout.<app>.<token>` are the app-facing reads.
- **One apply per generation.** The composed sheet is applied VERBATIM and
  coalesced by generation hash; the 50 ms debounce collapses the commit burst.
  Add-before-remove keeps a provider live on every swap; the app stylesheet
  and GTK theme are never touched.
- **Refresh.** `createAppearanceRefreshHandler(appearance, work?)` implements
  `["appearance-refresh", "<genHash>"]` and only answers the frozen v3 union
  (`applied`/`deferred`/`failed`, each naming the requested hash). It is
  idempotent by generation hash, does not advance on deferred/failed work, and
  emits exactly one JSON response. The old `{"ok":true}` ack is invalid.
- **Failure.** Missing `current`/generation artifacts are a no-op with the
  previous provider and token fallback; malformed content reports through
  `onError` and stays retryable. Literal hex outside the palette block,
  `transition` and `structure`/`variant` are rejected before GTK sees the
  sheet.
- **Exports.** `createAppearance`, `appearance`, `createAppearanceValue`,
  `appearanceValue`, `parseAppearanceJson`/`parseAppearanceTokens`,
  `parseGenerationManifest`, `generationAppearanceTarget`,
  `validateAppearanceCss`, `createReplacingAppearanceCssSink`,
  `createAppearanceRefreshHandler`, the state path/pointer constants and the
  `Appearance*`/`Generation*` types.

The v1 `theme`, `skin` and `skinValue` exports below remain for one release as
deprecated aliases; new app work uses Appearance.

## Theme (deprecated alias)

> **Deprecated in `v0.9.0`.** Use Appearance above. Theme remains exported for
> one release so existing bar/widget imports keep working.

One mechanism per app: one `Gio.FileMonitor`, one composed `Gtk.CssProvider`.

```ts
import { theme } from "ags-platform"

theme.apply()                          // install the palette now
const palette = theme.palette()        // { version: "1", mode?: "dark"|"light", roles: { primary: "#…", … } }
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
- theme-producer v0.6.0's mode metadata is accepted and exposed as
  `palette.mode` (`"dark"` or `"light"`): `mode` is the producer field, and
  the runtime-recognized aliases `scheme`, `appearance`, `variant`, `is_dark`
  and `dark` are tolerated with the runtime's precedence (`mode` first; string
  keys before boolean aliases). Metadata is never a palette role and is never
  emitted as `@define-color`. Older artifacts with no mode leave
  `palette.mode` undefined. Unknown top-level keys still fail, and role values
  are still validated as palette hex.
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
  `Palette`/`PaletteMode`/`Theme`/`ThemeOptions`/`CssSink`/`CssProvider*`
  types.
- Phase B (kit + per-app role migration, including btop-theme-studio and icme)
  is a separate ticket; the legacy aliases are not removed here.

## Skin (deprecated alias)

> **Deprecated in `v0.9.0`.** Use Appearance above. The v1 skin artifacts,
> watchers, `skin`/`skinValue` accessors and `createAppSkin` factory remain
> exported for one release while the apps migrate.

> **USER priority + one provider (read this first).** A skin is installed as
> ONE composed `Gtk.CssProvider` at `GTK_STYLE_PROVIDER_PRIORITY_USER` = **800**.
> AGS installs `app.start({ css })` at USER too, so an APPLICATION-priority
> (600) skin silently loses every conflict. On every swap the new provider is
> added **before** the old one is removed, and the skin must be the
> **last-installed provider** for it to win. The app stylesheet and GTK theme
> are never touched. Provider and `Gio.FileMonitor` refs are module-scoped; a
> monitor held only by a local is GC-collected and silently stops emitting.

A skin is palette/ink mapping + paint + rhythm/density, with **no structure or
variant tokens**. The runtime expands it; the platform only composes and
applies the expanded bytes.

- `$XDG_CONFIG_HOME/<configDir>/skin.css` — that app's runtime-expanded
  paint/token CSS. For the bar `configDir = ags`; `SKIN_CSS_PATH` /
  `SKIN_CSS_POINTER = "ags/skin.css"` are the bar's pointers. Every other app
  reads its own directory (`ags-clipboard`, `ags-notifications`, …).
- `$XDG_STATE_HOME/dotfiles/current/skin.json` — the one resolved token map,
  shared by every app (`SKIN_JSON_PATH` / `SKIN_JSON_POINTER =
  "dotfiles/current/skin.json"`).
- The palette artifacts stay shared and unchanged:
  `$XDG_CONFIG_HOME/ags/colors.css` and
  `$XDG_STATE_HOME/dotfiles/current/colors.yaml`.

`configDir` is an input, not a platform app list: contracts v0.6.0 emits
`current/skins/<configDir>.css` per target and links it as
`config/<configDir>/skin.css`.

```json
{
  "version": 1,
  "shape": {
    "radius-panel": 12,
    "radius-card": 9,
    "radius-cell": 7,
    "radius-pill": 20,
    "border-w": 1.5,
    "hairline-w": 1
  },
  "surface": {
    "bg-panel": "alpha(@surface, 0.94)",
    "bg-card": "alpha(@surface_container_high, 0.18)",
    "border": "@primary",
    "shadow": "none",
    "blur": "none"
  },
  "ink": {
    "ink": "@on_surface",
    "ink-dim": "alpha(@on_surface, 0.62)",
    "accent": "@primary",
    "ink-over": "auto"
  },
  "type": {
    "font-family": "inherit",
    "title-size": 12.5,
    "text-size": 13
  },
  "rhythm": { "gap": 8, "cell-pad": "8px 9px" },
  "layout": {
    "panel-width": 312,
    "bt-list-spacing": 4,
    "bar-row-height": 0,
    "chip-min": 0
  }
}
```

The declared groups are `shape`, `surface`, `ink`, `type`, `rhythm`, `layout`,
and the vocabulary is the canonical 24-token set from contracts v0.6.0:

- **numbers** (unitless, finite, `>= 0`): the four radii, `border-w`,
  `hairline-w`, `gap`, `title-size`, `text-size` and the four layout tokens.
  A length string such as `"12px"` is invalid; the expander adds `px`.
- **paint** (`surface.bg-panel`, `bg-card`, `border`): `transparent`, `@role`,
  `alpha(@role, 0..1)` or
  `color-mix(in srgb, @role <pct>%, transparent|@role)`.
- **shadow**: a non-empty CSS shadow string; `none` and
  `rgba(0,0,0,0.22)` are legal, hex is not. **blur**: `none` or
  `blur(<n>px)` with an optional `saturate(<n>)`.
- **ink**: `ink`, `ink-dim` and `accent` are `@role` or
  `alpha(@role, 0..1)`; `ink-over` is exactly `"auto"`.
- **type**: `font-family` is a non-empty string (`"inherit"` is legal).
- **rhythm**: `cell-pad` is exactly `"<n>px <n>px"`; `gap` is a number.

Token names are validated per token, not generically per group: unknown tokens
are rejected (the vocabulary is closed), as are literal hex, `transition`,
`structure`/`variant`/`order`/`presence` names, and unknown groups.

```ts
// The bar: the default singleton is createAppSkin({ configDir: "ags" }).
import { skin, skinValue } from "ags-platform"

skin.apply() // no-op if either skin artifact is missing

const unsubscribe = skin.subscribe((tokens) => {
  // `tokens.values` is the resolved `group.name` map
})
const width = skinValue("panel-width", 360)  // Accessor: width() / width.peek()
const spacing = skinValue("layout.bt-list-spacing", "6px")

// later
unsubscribe() // stops both artifact watchers when the last listener leaves
```

Every non-bar app builds its own instance and accessor:

```ts
import { createAppSkin, createAppSkinValue } from "ags-platform"

const skin = createAppSkin({ configDir: "ags-clipboard" })
skin.apply() // reads $XDG_CONFIG_HOME/ags-clipboard/skin.css + shared skin.json

const panelWidth = createAppSkinValue(skin, "layout.panel-width", 360)
const spacing = createAppSkinValue(skin, "layout.bt-list-spacing", 4)
```

Two instances own separate provider sinks and watchers. The default `skin`
singleton keeps the bar's `ags` pointers, so existing bar imports need no
change.

- **Composition:** the one provider's sheet is the runtime palette block
  (`colors.css` verbatim + `palette.v1` role defines, exactly as `theme.ts`
  composes it) followed by `skin.css`. The palette prefix is mandatory:
  without it, `@role` references paint near-black.
- **Reload:** one watcher per artifact, shared by all listeners, with the same
  50 ms debounce as the Theme adapter. A change reads/composes the next sheet,
  reapplies it, then notifies listeners. Missing artifacts are a no-op (the app
  fallback CSS stays); a malformed skin keeps the previous provider and reports
  through `onError`. The adapter never expands a skin.
- **Tokens:** `skinValue(key, fallback)` reads the bar singleton;
  `createAppSkinValue(skin, key, fallback)` reads an app-scoped instance. Both
  return an accessor-compatible cell (callable + `.peek()`). Bare names such as
  `panel-width` resolve within the declared group order; `group.name` is
  accepted too. Missing, removed or type-invalid tokens yield the fallback, and
  reloads update the cell in place so widgets do not remount.
- **Exports:** `createAppSkin`, `createAppSkinValue`, `skin`, `skinValue`,
  `SKIN_CSS_PATH`, `SKIN_JSON_PATH`, the pointer constants, `parseSkinJson`,
  `validateSkinCss`, `validateRoleExpression`, `isRoleExpression`,
  `composeSkinCss`, `createReplacingSkinCssSink`, `createSkin`,
  `createSkinValue`, `readSkinToken`, `skinTokenValue`, `SkinParseError` and the
  `AppSkinOptions`/`Skin`/`SkinOptions`/`SkinTokens`/`SkinCss*` types.

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
