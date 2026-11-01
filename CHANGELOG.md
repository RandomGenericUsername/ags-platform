# Changelog

Notable changes to `ags-platform`. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Release identity is the annotated git tag. The package stays `private` and
`package.json` keeps the historical `version: "0.0.0"` (as it did for `v0.1.0`
and `v0.2.0`); consumers pin the tag, not the manifest field.

## [Unreleased]

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
