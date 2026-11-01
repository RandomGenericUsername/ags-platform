---
id: REQ-013
title: "Theme provider: palette.v1 role API + change subscription"
kind: requirement
status: in-progress
lane: 3
links:
  openspec: none
  bmad: none
worktree: .worktrees/REQ-013/
branch: ticket/REQ-013-theme-provider-roles
---

# Theme provider: palette.v1 role API + subscription

## Requirement

The platform already owns a Theme port
(`adapters/theme.ts`, `ports/theme`, REQ-007). Consumers still couple to
artifact shape: `@color_*` GTK defines in style.css and direct `colors.yaml`
reads (ICME, btop-theme-studio). This ticket turns the Theme port into the
**provider seam**: one typed palette API plus one change subscription, with
producer shape hidden behind it.

The work is deliberately split so it can be deployed without touching any app:

- **Phase A — foundation (this branch, v0.4.0).** Typed `palette()` role API,
  `subscribe()` with one monitor, and one composed CSS provider that keeps the
  legacy `@color_*` projection byte-compatible while also defining every
  `palette.v1` role. No app or kit migration.
- **Phase B — migration (follow-up tickets).** Kit CSS + per-app role
  migration (bar widgets, icme, btop-theme-studio, wallpaper-selector, capture,
  clipboard, notifications), ending with removal of the legacy alias block.
  Phase B is NOT part of this branch.

## Phase A — behavior (implemented here)

1. `palette(): { version: string; roles: Readonly<Record<string, string>> }`
   parses the runtime `current/colors.yaml` (top-level scalar `role: "#hex"`
   entries; the legacy `colors:` list ignored). No YAML dependency: the file is
   machine-generated, and quoted/unquoted hex + comments are handled.
   Malformed input fails closed with `PaletteParseError`, naming the artifact
   and the 1-based line. Additive producer roles are preserved; the declared
   `palette.v1` vocabulary (50 Material roles + `on_backdrop`) is exported as
   `PALETTE_V1_ROLES`.
2. `subscribe(listener): () => void` attaches ONE `Gio.FileMonitor` to the
   resolved palette path (shared by all listeners), reloads the palette,
   re-applies the CSS, and only then notifies. The last unsubscribe releases
   the monitor. Listeners are change-only; `palette()` supplies the initial
   value.
3. ONE mechanism: one monitor + one composed `Gtk.CssProvider` per app/display.
   Each refresh reads/composes the next sheet first, adds the next provider,
   then removes the previous one (BUG-001 invariant, never accumulate). The
   legacy `colors.css` content is the byte-identical prefix of the sheet; the
   provider appends `@define-color <role> <hex>;` for every declared role.
   The legacy application is NOT removed in this phase.
4. Kit/exports + convention: palette types/helpers are exported from the
   package index; the role CSS convention is documented — the role name is the
   GTK named color (`@define-color primary …`, `@define-color on_backdrop …`,
   app CSS uses `@primary`/`@on_backdrop`). No app-specific logic in the
   platform; the adapter is the only place that knows the runtime paths.
5. Version `0.3.0` → `0.4.0` in the CHANGELOG (the annotated tag remains the
   release identity; `package.json` stays private at `0.0.0` by convention).
   The tag/publish is an orchestrator step, not this ticket.

## Phase A — acceptance

- [x] `palette()` + `subscribe()` typed API on the Theme port, conformance-
      tested against the runtime `palette.v1` vocabulary (REQ-006) with a
      fixture and against the live `colors.yaml`.
- [x] `subscribe` fires after the new palette is loaded and re-applied; one
      monitor is shared; unsubscribe releases it (idempotent, re-subscribable).
- [x] The provider replaces, never accumulates (add-then-remove); a malformed
      refresh keeps the previous provider/palette.
- [x] Legacy `colors.css` is applied verbatim as the provider's prefix; current
      `@color_*` apps are unchanged (no app migration in this phase).
- [x] Role defines are emitted for every declared role, including
      `on_backdrop`; additive roles are preserved.
- [x] Palette types + helpers are exported from the package index; the CSS
      convention is documented in `ports/palette.ts` and `README.md`.
- [x] `make test`, `make exports`, `make typecheck-tests` green; local
      `make typecheck` reports 0 in-tree errors.
- [x] No app-specific policy/paths enter the platform core (paths live in the
      dotfiles runtime adapter).
- [ ] Publish `v0.4.0` tag (orchestrator step; this branch is not tagged).

## Phase A — evidence / verify

Run from `.worktrees/REQ-013/`, branch `ticket/REQ-013-theme-provider-roles`,
base `a1bfbf4` (main).

| Claim | Command | Result |
| --- | --- | --- |
| Full pure suite | `make test` | `62 pass / 0 fail`, exit 0 |
| Package/export gate | `make exports` | `2 pass / 0 fail`, exit 0 |
| Pure test typecheck | `make typecheck-tests` | `OK: 0 errors in the pure test suite` |
| Local desktop typecheck | `make typecheck` | `OK: 0 errors in the ags-platform tree`; 7 tolerated `/usr/share/ags/js` errors |
| `palette.v1` fixture parses all declared roles incl. `on_backdrop` | `node --test tests/palette.test.ts` | 7 tests pass: 51/51 vocabulary roles, additive extras kept, legacy `colors:` ignored, frozen role map |
| Malformed input fails clearly | `node --test tests/palette.test.ts` | `PaletteParseError` with `source:line` for invalid hex, duplicate role, stray indented line, unterminated quote, nested block, empty file, non-key line |
| Subscription + cleanup | `node --test tests/theme-provider.test.ts` | one shared monitor for two listeners; fires after load with both listeners seeing the new roles; last unsubscribe stops the monitor; re-subscribe starts exactly one |
| Provider replacement + legacy compatibility | `node --test tests/theme-provider.test.ts` | 5 refreshes leave exactly one provider (`add:next → remove:previous`, peak 2); installed sheet starts with the legacy fixture bytes and adds role defines |
| Malformed refresh keeps the old provider | `node --test tests/theme-provider.test.ts` | no new `add`, previous palette retained, error reported, listeners not called |
| Live runtime artifact (not a fixture) | `node --input-type=module -e '…parsePaletteYaml(readFileSync("~/.local/state/dotfiles/current/colors.yaml"))…'` | `version 1`, `56 roles`, `on_backdrop #e3e1e9`, `missing v1 roles []`, legacy prefix preserved (`true`, 2917 bytes) |
| Red-before proof (role projection is load-bearing) | temporarily forced `composeThemeCss` to legacy-only, then `node --test tests/theme-provider.test.ts` | 2 failures (`…legacy colors.css verbatim plus role defines`, `subscribe shares ONE monitor…`); restored byte-for-byte, 10/10 green |
| Adapter keeps one provider + one monitor | `node --test tests/theme-provider.test.ts` | source shape: `add_provider_for_display` ×1, `remove_provider_for_display` ×1, `monitor_file` ×1, `GLib.timeout_add` ×1, `load_from_string`, `Gio.FileMonitorFlags.WATCH_MOVES`, no `app.apply_css` |
| Atomic repoint produces a monitor event | `gjs` probe: `Gio.File.new_for_path(link).monitor_file(WATCH_MOVES)`, then `ln -sfn new link` | one `RENAMED` event per repoint; writing through the link emits none — the runtime's atomic symlink swap is the trigger |

## Phase A — build notes

- `ports/palette.ts` — pure vocabulary + parser + CSS projection. Mirrors the
  runtime parser subset (`dotfiles-runtime/src/runtime/application/palette_conformance.py`)
  so the platform accepts exactly what the producer emits.
- `ports/theme.ts` — `Theme` now has `apply`/`palette`/`subscribe`;
  `createTheme(ThemeOptions)` takes the two stable paths, a sink, a reader and a
  file watcher. `composeThemeCss(legacyCss, palette)` is the one-provider
  composition point. Failure policy: `palette()` fails closed; `apply()` degrades
  to legacy-only (reported via `onError`) so a missing producer cannot brick an
  app; a change reload never downgrades an already-installed provider.
- `adapters/theme.ts` — resolves `~/.config/ags/colors.css` and
  `$XDG_STATE_HOME/dotfiles/current/colors.yaml`, loads the composed sheet with
  `Gtk.CssProvider.load_from_string`, and holds one debounced
  `Gio.FileMonitor` on the palette link.
- `index.ts` — exports the palette API/helpers and the new Theme types.
- `README.md` / `CHANGELOG.md` — documented role convention + v0.4.0.
- `tests/fixtures/colors.yaml` — conforming producer fixture.

## Phase A — commits

| Commit | Subject |
| --- | --- |
| `TBD-start` | `chore(REQ-013): start — record worktree/branch, move to in-progress` |
| `TBD-feat` | `feat(REQ-013): theme provider palette role API + one subscription` |
| `TBD-docs` | `docs(REQ-013): record Phase A evidence, tick acceptance` |

## Phase B — follow-up (NOT this branch)

Acceptance below is tracked by the follow-up migration tickets, not here:

- [ ] Kit CSS contains no `@color_` / `color0..15` references; kit components
      use role-named GTK colors (`@surface_container`, `@on_surface`, …).
- [ ] All apps migrated: bar widgets, icme, btop-theme-studio,
      wallpaper-selector, capture, clipboard, notifications. Per-app refresh
      handlers stop reading `colors.yaml`/`colors.gtk.css` and rely on
      `theme.subscribe()`.
- [ ] `btop-theme-studio` and `icme` consume `theme.palette()` instead of
      parsing the artifact themselves; `on_backdrop` is used by floating
      surfaces over the wallpaper.
- [ ] The legacy `color_00..15` alias block and the appended role duplication
      are removed from the provider; the platform provider becomes the only
      role source.
- [ ] Conformance: at least the kit + one app migrated in fixtures; all app
      gates green; deploy after the platform pin bump.

Phase B must preserve the Phase A invariants: one monitor, one provider,
add-then-remove, legacy behavior only removed once every consumer is migrated.

## Deployment (orchestrator)

1. Review/merge this branch (do not tag in the worktree).
2. Tag `v0.4.0` on the merge commit; publish the release.
3. Bump `AGS_PLATFORM_VERSION` in `ags-apps/Makefile` from `v0.3.0` to
   `v0.4.0` and re-run the platform bootstrap (`make ags-platform-dev` / the
   provisioning pin step) so every app's `node_modules/ags-platform` points at
   the new tag.
4. No app code change is required for this release: `theme.apply()` keeps its
   signature and the legacy `@color_*` sheet is applied verbatim.
