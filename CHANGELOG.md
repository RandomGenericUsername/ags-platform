# Changelog

Notable changes to `ags-platform`. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Release identity is the annotated git tag. The package stays `private` and
`package.json` keeps the historical `version: "0.0.0"` (as it did for `v0.1.0`
and `v0.2.0`); consumers pin the tag, not the manifest field.

## [Unreleased]

## [1.0.0] - 2026-11-06

Generations v3: state-only appearance consumption and generation-bound
apply/ack for contracts `v0.8.0`. Ticket:
[`REQ-019`](./tickets/REQ-019-generations-v3/ticket.md).

### Added

- **`ports/appearance.ts` v3 state plane.** `parseGenerationManifest` verifies
  `version: 3`, a lowercase 64-hex `generationHash`,
  `appearance.tokensPath = "appearance/tokens.json"` and unique
  `appearance.targets` whose paths are exactly
  `appearance/<configDir>.css`. `generationAppearanceTarget` fails closed for a
  generation that does not publish the consumer's `configDir`.
  `resolveAppearancePaths(configDir, stateHome)` returns only
  `state/dotfiles/current`, its `manifest.json`, `generations/` and the
  current appearance/token paths.
- **`applyGeneration(genHash)` and `apply(genHash?)`.** The core prefers the
  immutable `generations/<genHash>/...` tree; a `current` fallback verifies
  `manifest.generationHash` before and after the artifact read. A stale
  pointer, missing generation, corrupt generation manifest or hash mismatch
  installs nothing and returns `deferred`/`failed` with the requested hash.
  `appliedHash()` exposes the exact installed generation and repeated
  requests for one generation install exactly one provider.
- **`createAppearanceRefreshHandler` v3.** Implements
  `["appearance-refresh", "<genHash>"]` and answers only
  `{"applied":"<genHash>"}`,
  `{"deferred":"reason","genHash":"<genHash>"}` or
  `{"failed":"reason","retryable":bool,"genHash":"<genHash>"}`. Malformed
  requests, old `palette-refresh` commands and returned `{"ok":true}` work
  results are rejected; in-flight requests answer `deferred:"busy"`.
- `APPEARANCE_MANIFEST_PATH` and `APPEARANCE_GENERATIONS_PATH` constants;
  `APPEARANCE_WATCH_POINTER` is now `dotfiles/current`.

### Changed

- **State-only reads.** `createAppearance({ configDir })` reads
  `current/manifest.json`, `current/appearance/<configDir>.css` and
  `current/appearance/tokens.json`. The
  `$XDG_CONFIG_HOME/<configDir>/appearance.css` convenience link and all v1/v2
  skin paths are no longer read by the Appearance consumer.
- **One watched hop.** The adapter monitors
  `$XDG_STATE_HOME/dotfiles/current` with
  `Gio.FileMonitorFlags.WATCH_MOVES` and a 50 ms debounce; monitors/providers
  remain module-scoped. `current/appearance` is no longer a watch proxy.
- **One provider per generation.** The composed sheet remains verbatim at
  USER priority 800 with add-before-remove, but idempotence is keyed by
  `genHash` instead of CSS bytes, so a generation is applied once.
- `ports/app-conformance.ts` accepts the v3 `appearance-refresh` command/helper
  and keeps the deprecated `palette-refresh` names for the migration window.
- `README.md` leads with Generations v3 and the v3 refresh protocol.

### Deprecated

- `createPaletteRefreshHandler` and `PALETTE_REFRESH_COMMAND` remain exported
  for the v2 app migration. The v3 handler does not use them and does not
  accept their `{"ok":true}` result. The v1 `theme`/`skin` aliases remain
  unchanged.

### Tests

- New `tests/appearance-v3.test.ts` covers manifest verification, state-only
  path resolution, direct generation-path apply, v3 token reads, stale pointer
  → deferred, hash-mismatch never applied, pointer move during read, exactly
  one apply per generation, watch `current` only, missing-generation fallback,
  the v3 handler ack/deferred/failed/invalid-work/in-flight cases and no
  config-home read.
- `tests/appearance.test.ts` keeps the v2 token/CSS vocabulary and sink tests
  and now pins the state-only adapter/path contract.

### Release

- Annotated tag `v1.0.0` on the ticket branch's closeout commit.
- `package.json` remains `private` at `0.0.0`; the tag is the release identity.
- Gates: targeted appearance suites, `make test` (128 pass), `make exports`
  (2 pass), `make typecheck-tests` (0 errors) and local `make typecheck`
  (0 in-tree errors; 7 tolerated `/usr/share/ags/js` errors) are green.

## [0.9.1] - 2026-11-06

REQ-018: accept theme-producer v0.6.0 palette mode metadata without degrading
the Theme provider. Ticket:
[`REQ-018`](./tickets/REQ-018-palette-mode-metadata/ticket.md).

### Fixed

- **`parsePaletteYaml` no longer mistakes `mode` for a role.** theme-producer
  v0.6.0 emits a top-level `mode: "dark"` / `mode: "light"` scalar in every
  generated `colors.yaml`; the parser previously threw
  `PaletteParseError … role "mode" has invalid value "dark"`, so
  `theme.apply()` degraded to legacy CSS and `theme.palette()` failed.
- The runtime-recognized aliases are tolerated while staying out of the role
  map: `scheme`, `appearance` and `variant` as strings, and `is_dark`/`dark`
  as booleans. Mode resolution follows the runtime precedence
  (`mode`, `scheme`, `appearance`, `variant`, then `is_dark`, `dark`).
- Metadata is never projected as `@define-color`; theme provider composition
  and priority are unchanged. Unknown top-level keys still fail, role values
  are still validated as palette hex, and the legacy `colors:` list still
  parses as a skipped block.

### Added

- `Palette.mode?: "dark" | "light"` exposes the resolved metadata mode when
  the artifact carries one; older artifacts leave it undefined. The
  `PaletteMode` type is exported from the package root.

### Tests

- `tests/palette.test.ts` parses the real-shaped mode-bearing fixture (roles +
  legacy `colors:`), a light artifact, every alias and the runtime precedence,
  an arbitrary alias string, invalid mode/boolean metadata, an unknown
  top-level scalar, and unchanged role-hex rejection.
- `tests/theme-provider.test.ts` composes a `mode`-bearing palette through
  `theme.apply()` and asserts the metadata never becomes a role define, while
  `palette()` exposes `mode` before and after a refresh.

### Release

- Annotated tag `v0.9.1` on the ticket branch's closeout commit.
- `package.json` remains `private` at `0.0.0`; the tag is the release identity.
- Gates: targeted parser/provider suites (19 pass), `make test` (113 pass),
  `make exports` (2 pass), `make typecheck-tests` (0 errors) and the local
  `make typecheck` (0 in-tree errors; 7 tolerated `/usr/share/ags/js` errors)
  all green.

## [0.9.0] - 2026-11-06

REQ-017: unified Appearance consumer for contracts `v0.7.0`. One provider,
one monitor on `current/appearance`, one whole-appearance apply. The v1
`theme`/`skin`/`skinValue` exports remain as deprecated aliases for one
release. Ticket: [`REQ-017`](./tickets/REQ-017-appearance-adapter/ticket.md).

### Added

- **`ports/appearance.ts`** (pure): the `appearance.v2` token
  types/parser (`version: 2` + `surface`/`state`/`type`/`ink`/`layout`,
  optional `mode.dark`/`mode.light` group overrides), `appearanceValue` /
  `readAppearanceToken`, composed-CSS validation, a replacing sink at USER
  priority (800) and the `createAppearance` core with `apply()`, `tokens()`,
  `subscribe()` and `value(path, fallback)`.
- **`adapters/appearance.ts`**: `createAppearance({ configDir })` watches ONLY
  `$XDG_STATE_HOME/dotfiles/current/appearance` with
  `Gio.FileMonitorFlags.WATCH_MOVES` and a 50 ms debounce, reads
  `$XDG_CONFIG_HOME/<configDir>/appearance.css` +
  `current/appearance/tokens.json`, and installs the composed sheet verbatim
  as one last-installed provider. Monitors/providers are module-scoped.
- **`createAppearanceRefreshHandler(appearance, work?)`**: keeps the
  `palette-refresh` transport but always re-applies the whole appearance
  before app-owned derived work. Idempotent by appearance hash, one JSON
  response.
- Pure `adapters/appearance-scope.ts` carries the per-`configDir` path
  resolution so the stock `node --test` runner exercises it without GTK/GLib.
- `index.ts` explicitly re-exports the Appearance port, adapter, refresh
  helper and types.

### Changed

- One apply per generation: identical CSS + token content (the atomic repoint
  plus convenience-link creation) is coalesced, so a generation never installs
  twice. Missing artifacts are a no-op; malformed artifacts keep the previous
  provider and report through `onError`.
- `README.md` leads with Appearance; the Theme and Skin sections are marked
  deprecated aliases.

### Deprecated

- `theme`, `skin`, `skinValue`, `createAppSkin` and `createAppSkinValue`
  remain exported and behave unchanged for one release. New code uses
  `createAppearance`/`appearance` and the v2 token paths.

### Tests

- `tests/appearance.test.ts` (14 tests) pins the watched
  `current/appearance` path, one apply per rename generation, verbatim CSS at
  800 with add-before-remove, v2 token parse/lookup/fallback, mode overrides,
  the refresh contract, missing/malformed fallback and
  structure/hex/transition rejection. The existing Skin suite (26 tests) is
  untouched.

### Release

- Annotated tag `v0.9.0` on the ticket branch's closeout commit.
- `package.json` remains `private` at `0.0.0`; the tag is the release identity.
- Gates: `node --test tests/skin.test.ts tests/appearance.test.ts` (40 pass),
  `make test` (111 pass), `make exports` (2 pass), `make typecheck-tests`
  (0 errors) and the local `make typecheck` (0 in-tree errors) all green.

## [0.8.0] - 2026-11-05

REQ-016: app-scoped Skin instances. Every AGS app reads its own
`$XDG_CONFIG_HOME/<configDir>/skin.css` while sharing the one token map.
Ticket: [`REQ-016`](./tickets/REQ-016-skin-app-scope/ticket.md).

### Added

- **`createAppSkin({ configDir, ...overrides })`** in `adapters/skin.ts`.
  Resolves `$XDG_CONFIG_HOME/<configDir>/skin.css` and keeps the shared
  `$XDG_STATE_HOME/dotfiles/current/skin.json` plus the unchanged palette
  artifacts. Sink, watcher, composition, USER priority (800) and failure
  semantics are the same as the bar's. Each instance owns its provider sink and
  monitors; `configDir` is an input, not a platform app list.
- **`createAppSkinValue(skin, key, fallback)`** binds the reactive accessor to
  an app-scoped instance. `skinValue(key, fallback)` keeps its existing
  signature for the bar.
- Pure `adapters/skin-scope.ts` carries the per-`configDir` path resolution so
  the stock `node --test` runner exercises it without GTK/GLib.
- `index.ts` explicitly re-exports `createAppSkin`, `createAppSkinValue` and
  `AppSkinOptions`.

### Changed

- The default `skin` singleton is now exactly
  `createAppSkin({ configDir: "ags" })`; the bar's behavior and imports are
  unchanged.

### Tests

- `tests/skin.test.ts` grows to 26 tests: per-configDir path resolution (one
  shared `skin.json`), two instances with separate providers and monitors, the
  `ags` default, missing-artifact no-op, USER priority and palette-block
  composition on an app-scoped instance.

### Release

- Annotated tag `v0.8.0` on the ticket branch's closeout commit.
- `package.json` remains `private` at `0.0.0`; the tag is the release identity.
- Gates: `make test` (97 pass), `make exports` (2 pass),
  `make typecheck-tests` (0 errors) and the local `make typecheck`
  (0 in-tree errors) all green.

## [0.7.0] - 2026-11-05

REQ-015: correct Skin token validation against the frozen contracts v0.6.0
vocabulary. Ticket:
[`REQ-015`](./tickets/REQ-015-skin-token-validation/ticket.md).

### Fixed

- **Real skins no longer fail validation.** `parseSkinJson` validated every
  `surface.*` and `ink.*` value as a bare `@role`, so it rejected the resolved
  built-ins: `alpha(@surface, 0.94)` paint,
  `color-mix(in srgb, @outline 60%, transparent)`, `shadow: "none"`,
  `blur: "none"`, `ink-dim: "alpha(@on_surface, 0.62)"` and `ink-over: "auto"`.
  Values are now validated by their canonical per-token kind (number / paint /
  shadow / blur / ink / auto / cell-pad / font).
- **`shape.hairline-w`** is accepted as a unitless finite non-negative number.
  The three built-in resolved fixtures (`glass`, `flat`, `paper`) now carry the
  full 24-token vocabulary.
- **Unknown tokens are rejected.** The canonical vocabulary is closed; an
  unknown name such as `shape.radius` or an app-additive layout token no longer
  passes as a generic number.
- **Wrong value kinds are rejected:** numeric length strings (`"12px"` or
  `"312"` where a number is required), a bare hex or arbitrary string as paint,
  an out-of-range `alpha()`, a malformed `color-mix()`, bad `blur`, a bad
  `cell-pad`, `ink-over: "manual"`, and a shadow containing hex.

### Changed

- `isRoleExpression` / `validateRoleExpression` now accept both `@role` and
  `alpha(@role, 0..1)`, matching the ink grammar. All other exported Skin
  symbols and their call signatures are unchanged.
- `ports/skin.ts` and `SKIN_TOKEN_GROUPS` document the per-token v0.6.0
  vocabulary and value grammar. README carries the real resolved `glass`
  document instead of the old synthetic `"12px"` example.

### Tests

- `tests/skin.test.ts` grows to 21 tests, including hard-coded resolved
  fixtures for all three built-ins (`tests/fixtures/skins.ts`, source manifest
  names and contract tag recorded there; no cross-repo import) and negative
  cases for every rejected value kind above.

### Release

- Annotated tag `v0.7.0` on the ticket branch's closeout commit.
- `package.json` remains `private` at `0.0.0`; the tag is the release identity.
- Gates: `make test` (92 pass), `make exports` (2 pass),
  `make typecheck-tests` (0 errors) and the local `make typecheck`
  (0 in-tree errors) all green.

## [0.6.0] - 2026-11-05

REQ-014: the frozen **Skin Spec v1** lands as a pure port + display adapter.
Ticket: [`REQ-014`](./tickets/REQ-014-skin-port-adapter/ticket.md).

### Added

- **Skin port** (`ags-platform`, `ports/skin.ts`, PURE):
  `SkinTokens`, `SKIN_TOKEN_GROUPS` / `SKIN_VERSION`,
  `parseSkinJson`, `validateSkinCss`, `validateRoleExpression` /
  `isRoleExpression`, `composeSkinCss`,
  `createReplacingSkinCssSink`, `createSkin`, `createSkinValue`,
  `readSkinToken`, `skinTokenValue` and `SkinParseError`. The token map is the
  resolved `shape` / `surface` / `ink` / `type` / `rhythm` / `layout` groups.
  `surface.*` and `ink.*` must be palette role expressions (`@role`); literal
  hex, `transition`, and `structure`/`variant` groups/tokens are rejected. A
  skin never expands CSS or restructures a widget.
- **Skin adapter** (`ags-platform`, `adapters/skin.ts`): resolves
  `$XDG_CONFIG_HOME/ags/skin.css` and
  `$XDG_STATE_HOME/dotfiles/current/skin.json` as constants, composes the
  runtime palette block with the runtime-expanded skin CSS, and installs ONE
  replacing provider at `GTK_STYLE_PROVIDER_PRIORITY_USER` (800). The new
  provider is added before the previous one is removed, so the skin is the
  last-installed provider on every swap. Providers and `Gio.FileMonitor`s are
  retained in module-scoped sets (the GC trap), both artifacts are watched
  with the Theme adapter's 50 ms debounce, and `skinValue(key, fallback)`
  exposes an accessor-compatible reactive token cell.
- **Failure policy:** missing skin artifacts are a no-op (the app fallback CSS
  stays); a malformed skin keeps the previous provider and reports through
  `onError`; the app stylesheet and GTK theme are never modified.
- **Tests** (`tests/skin.test.ts`, 16 tests): palette-block composition and
  known-ink resolution, explicit USER priority, add-before-remove replacement,
  GC-safe watcher retention/cleanup, reload on either artifact, missing/
  malformed fallbacks, accessor fallback/update, and literal-hex / structure /
  transition rejection.

### Changed

- `index.ts` explicitly re-exports the Skin port, token/accessor helpers and
  the `skin` / `skinValue` adapter bindings (no `export *`).

### Release

- Annotated tag `v0.6.0` on the ticket branch's closeout commit.
- `package.json` remains `private` at `0.0.0`; the tag is the release identity.
- Gates: `make test` (87 pass), `make exports` (2 pass),
  `make typecheck-tests` (0 errors) and the local `make typecheck`
  (0 in-tree errors; 7 tolerated AGS-runtime errors) all green.

## [0.4.0] - 2026-11-01

REQ-013 Phase A: the Theme port becomes the palette provider — typed
`palette.v1` roles plus one change subscription, with the legacy `@color_*`
projection unchanged. Ticket:
[`REQ-013`](./tickets/REQ-013-theme-provider-roles/ticket.md).

### Added

- **Typed palette API** (`ags-platform`, `ports/palette.ts`):
  `Palette`, `PALETTE_VERSION`, `PALETTE_V1_ROLES`, `parsePaletteYaml`,
  `renderPaletteCss`, `paletteCssVariable`, `missingPaletteRoles` and
  `PaletteParseError`. `parsePaletteYaml` reads the runtime's machine-generated
  `current/colors.yaml` with no YAML dependency: top-level quoted/unquoted
  `role: "#hex"` scalars and comments, the legacy `colors:` list ignored, an
  optional `version:` scalar (default `"1"`). Malformed input fails closed with
  the artifact path and 1-based line. The 51-role `palette.v1` vocabulary is
  declared from runtime REQ-006 (50 Material roles + `on_backdrop`); additive
  producer roles are preserved.
- **Palette subscription and CSS projection on the Theme port**
  (`ags-platform`, `ports/theme.ts`): `Theme.palette()` and
  `Theme.subscribe(listener)`, `ThemeOptions`, `PaletteListener` and
  `composeThemeCss`. One `Gio.FileMonitor` is shared by every listener and is
  released by the last unsubscribe; listeners run only after the new palette
  has loaded and been applied. A malformed refresh keeps the previous
  palette/provider and reports through `onError`.
- **Role CSS convention** documented in `ports/palette.ts` and `README.md`:
  every declared role is projected as `@define-color <role> <hex>;`, so app
  CSS uses `@primary`, `@on_surface`, `@on_backdrop` with no alias prefix.
  `paletteCssVariable(role)` builds the `@role` reference.
- **Single composed provider**: the adapter reads the legacy `colors.css`, adds
  the role block, and installs the result as ONE provider — legacy content is
  the byte-identical prefix, so every current `@color_*` app resolves exactly
  as before. The adapter now also resolves
  `$XDG_STATE_HOME/dotfiles/current/colors.yaml` (via `GLib.get_user_state_dir`)
  and watches the link for atomic repoints.

### Changed

- `createTheme` now takes `ThemeOptions` (`legacyCssPath`, `palettePath`, `sink`,
  `readFile`, `watchFile`, `onError`) instead of `(palettePath, sink)`.
  `CssSink.apply` and `CssProviderHost.add` take CSS text (`load_from_string`)
  instead of a path, because the legacy sheet and role defines must travel in
  one provider. `createReplacingCssSink` keeps the add-then-remove contract.
  This is a port-level change only: apps keep calling `theme.apply()`.
- Pure suite grows to 62 tests: palette parsing/failures, quoted/unquoted hex,
  subscription + cleanup, one-monitor sharing, provider replacement, legacy
  byte-compatibility and the adapter's one-monitor/one-provider source shape.

### Deferred

- **Phase B** — kit CSS on role names plus per-app role migration (bar widgets,
  icme, btop-theme-studio, wallpaper-selector, capture, clipboard,
  notifications) and removal of the legacy aliases. Follow-up tickets; this
  release intentionally changes no app.

## [0.3.0] - 2026-10-26

The standalone AGS app contract lands in the platform, with the Theme fix that
live palette refreshes depend on. Tickets:
[`REQ-012`](./tickets/REQ-012-ags-app-manifest-helper/ticket.md),
[`BUG-001`](./tickets/BUG-001-theme-provider-accumulation/ticket.md).

### Added

- **App manifest types and validator** (`ags-platform`, `ports/app-manifest.ts`):
  `AgsAppManifestLive`, `AgsAppManifestRestart`, `AgsAppManifest`,
  `AGS_APP_MANIFEST_FILE`, `AGS_APP_MANIFEST_SCHEMA_VERSION`,
  `AGS_APP_PATH_SEGMENT_PATTERN`, `validateAgsAppManifest` and
  `parseAgsAppManifest`. The union mirrors the contracts schema:
  `additionalProperties: false`, `schemaVersion: 1`, one lowercase path segment
  for `app`/`instance`/`configDir`, and `mode: "restart"` rejects
  `holdsUnsavedState: true`. Invalid JSON is reported as a validation issue, not
  thrown. Deployed identity equality remains runtime-owned.
- **Palette-refresh handler** (`ags-platform`, `ports/palette-refresh.ts`):
  `PALETTE_REFRESH_COMMAND`, `createPaletteRefreshHandler`, and the
  `PaletteRefresh`/`PaletteRefreshRequestHandler`/`PaletteRefreshResult` types.
  The helper validates `["palette-refresh", "<appearance-hash>"]`, invokes the
  app refresh exactly once, and writes exactly one JSON-encoded string on every
  path: `{"ok":true}`, `{"ok":true,"deferred":"..."}` or
  `{"ok":false,"error":"...","retryable":bool}`. A concurrent request gets the
  retryable `busy` response; throws and rejections are retryable failures;
  malformed requests and invalid result objects are terminal failures. It never
  answers `ok:true` before an async refresh settles and never schedules
  follow-up work.
- **Template-conformance gate** (`ags-platform`, `ports/app-conformance.ts`):
  `AGS_APP_REQUIRED_FILES` and `checkAppRepo(reader)`. The pure check covers the
  required app-repo files, at least one CI workflow and test tree, the ticket
  template/INDEX flow, manifest shape and identity-field format, and a live
  app's `palette-refresh` handler registration in runtime source (not tests or
  tickets).
- **Conformance Node adapter + CLI** (`ags-platform/conformance/*`): the
  `createNodeAppRepoReader`/`checkAppRepoAt`/`formatAppConformanceReport`/
  `runAppConformanceCli` bindings, plus the invocable
  `conformance/check.ts` entry point (`node .../conformance/check.ts .`).
  `./conformance/*` is a separate export subpath so the GJS runtime bundle
  never pulls in `node:fs`. `make exports` now covers the new subpath.

### Fixed

- **BUG-001 — palette provider accumulation.** `adapters/theme.ts` routed every
  refresh through the AGS app CSS helper, which creates, adds and retains a
  `Gtk.CssProvider` per call. `ports/theme.ts` now exports
  `createReplacingCssSink(host)` plus `CssProviderHandle`/`CssProviderHost`: each
  apply adds the next provider before removing the previous one, and only
  removes a handle it added itself. The adapter binds that sink to
  `Gtk.CssProvider`/`Gtk.StyleContext` at `STYLE_PROVIDER_PRIORITY_USER` and no
  longer imports or calls `app.apply_css`. The app stylesheet installed at
  `app.start({ css })` and the GTK theme are untouched, and the public
  `Theme`/`CssSink` port is unchanged. A fake-display regression test proves
  `add:next → remove:previous` across repeated refreshes with exactly one
  provider installed.

### Release

- Annotated tag `v0.3.0` on the merged release commit.
- `package.json` remains `private` at `0.0.0`; the tag is the release identity.
- Gates: `make test` (48 pass), `make exports` (2 pass),
  `make typecheck-tests` (0 errors) and the local `make typecheck` (0 errors in
  the `ags-platform` tree; 7 tolerated AGS-runtime errors) all green.

Earlier releases (`v0.1.0` extracted platform, `v0.2.0` overlay lifecycle)
predate this changelog; their annotated tags are the record.
