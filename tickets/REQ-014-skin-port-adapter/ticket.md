---
id: REQ-014
title: "Skin port + adapter: composed skin CSS, reactive tokens, USER priority"
kind: requirement
status: done
lane: 3
links:
  openspec: none
  bmad: none
worktree: .worktrees/REQ-014/
branch: ticket/REQ-014-skin-port-adapter
---

# Skin port + adapter: composed skin CSS, reactive tokens, USER priority

## Requirement

Port the frozen **Skin Spec v1** into the platform. A skin is a palette/ink
mapping + paint + rhythm/density. It carries **no** structure or variant
tokens. The runtime owns expansion; the platform owns composition and
application.

Two runtime artifacts are the contract:

- `$XDG_CONFIG_HOME/ags/skin.css` — the runtime-expanded CSS (paint and
  token custom properties). The adapter never expands a skin; it applies these
  bytes as-is.
- `$XDG_STATE_HOME/dotfiles/current/skin.json` — the resolved token map with
  top-level groups `shape`, `surface`, `ink`, `type`, `rhythm`, `layout`.

The adapter composes **one** `Gtk.CssProvider` from the runtime palette block
(the same `colors.css` + `colors.yaml` composition `theme.ts` uses) **plus**
`skin.css`. That provider is installed at `GTK_STYLE_PROVIDER_PRIORITY_USER`
(800). This is load-bearing: AGS installs `app.start({ css })` at USER, so an
APPLICATION-priority skin silently loses. The new provider is added **before**
the previous one is removed, and the skin provider must be the last-installed
provider on every swap.

The adapter watches `skin.css` and `skin.json` (one logical reload
subscription, 50 ms debounce like `theme.ts`), reloads the composed sheet,
reapplies it, then notifies listeners. Provider and `Gio.FileMonitor` refs are
module-scoped; a monitor held only by a local is GC-collected and silently
stops emitting.

Widgets read rhythm/layout tokens through an accessor-compatible
`skinValue(key, fallback)`; missing or invalid tokens yield the fallback.
Missing artifacts are a no-op (the app fallback CSS stays), a malformed skin
keeps the previous provider and reports through the existing error hook, and
the app stylesheet is never touched.

## Frozen contract

- Groups: `shape`, `surface`, `ink`, `type`, `rhythm`, `layout`.
- Forbidden: `structure` and `variant` groups/tokens; literal hex colors in
  skin tokens or skin CSS; `transition` in skin tokens/CSS.
- `surface.*` / `ink.*` values are palette role expressions (`@role`); a
  literal hex is invalid.
- The composed provider always includes the palette role block, so a known ink
  token (`@on_surface`) resolves instead of painting near-black.
- `skin.json` version `"1"`; additive tokens inside the declared groups are
  accepted (the vocabulary is the group set + token grammar, not a closed list
  of every token name).

## Acceptance

- [x] `ports/skin.ts` is pure (no `gi://`, no `ags`, no I/O): token types,
      `parseSkinJson`, contract validation, role-expression validation,
      `composeSkinCss`, replacing sink, `createSkin`, token accessor factory.
- [x] `adapters/skin.ts` resolves the two XDG pointers, reads/composes/applies,
      passes USER priority (800), replaces add-before-remove, holds monitors
      module-scoped, debounces 50 ms, reports through `onError`, and exposes
      `skinValue()`.
- [x] `index.ts` explicitly re-exports the new port + adapter symbols.
- [x] Pure tests prove palette composition, USER priority, add-before-remove,
      GC-safe monitor lifetime/cleanup, reload on either file, missing-artifact
      no-op, malformed-skin retention, accessor fallback, and literal-hex /
      structure / transition rejection.
- [x] README + CHANGELOG document the USER-priority rule and one-provider
      invariant prominently; INDEX updated.
- [x] `make test`, `make typecheck-tests` and local `make typecheck` green.
- [x] Annotated `v0.6.0` tag (next minor; existing tags untouched).

## Evidence / verify

Run from `.worktrees/REQ-014/`, branch `ticket/REQ-014-skin-port-adapter`,
base `31f0d38` (main).

| Claim | Command | Result |
| --- | --- | --- |
| Skin suite | `node --test tests/skin.test.ts` | `16 pass / 0 fail`, exit 0 |
| Full pure suite | `make test` | `87 pass / 0 fail`, exit 0 |
| Package/export gate | `make exports` | `2 pass / 0 fail`, exit 0 |
| Pure test typecheck | `make typecheck-tests` | `OK: 0 errors in the pure test suite` |
| Local desktop typecheck | `ags types -d "$PWD" -u` then `make typecheck` | `OK: 0 errors in the ags-platform tree`; 7 tolerated `/usr/share/ags/js` errors |
| Palette composition includes roles before skin | `node --test tests/skin.test.ts` | composed sheet starts with legacy `colors.css`, defines `on_surface`/`surface_container`, and `.skin-panel` follows the role block |
| Known ink token resolves | `node --test tests/skin.test.ts` | `ink.text === "@on_surface"` and the composed sheet defines `@on_surface` before `color: @on_surface` |
| USER priority forwarded | `node --test tests/skin.test.ts` | every `host.add` receives 800; `SKIN_PROVIDER_PRIORITY = 800`; no APPLICATION constant in the adapter |
| Add-before-remove | `node --test tests/skin.test.ts` | 5 refreshes: `add:n+1 → remove:n`, exactly one provider installed, peak 2 |
| GC-safe monitor lifetime | `node --test tests/skin.test.ts` | 2 active watchers shared by listeners, both released by the last unsubscribe, re-subscribe starts 2; adapter source has module-scoped `activeMonitors`/`activeProviders` sets |
| Reload on either artifact | `node --test tests/skin.test.ts` | changing either `skin.css` or `skin.json` replaces the composed provider and notifies after install |
| Missing / malformed policy | `node --test tests/skin.test.ts` | missing artifacts install nothing and report nothing; malformed JSON/CSS keeps the previous provider and reports a `SkinParseError` |
| Accessor fallback | `node --test tests/skin.test.ts` | `panel-width`, `bt-list-spacing`, `chip-min` read/update in place; missing and type-invalid values use the fallback |
| Literal-hex/structure/transition rejection | `node --test tests/skin.test.ts` | token and CSS validation reject `#hex`, `structure`/`variant`, `transition` and non-`@role` surface/ink values |

Note: `scripts/worktree-guard.sh --check-clean` (the spelling in
`tickets/LIFECYCLE.md`) prints usage and exits 2 because the script accepts
`check-clean`; `create` itself runs the cleanliness check and succeeded. This
ticket records the discrepancy instead of editing the guard.

## Commits

| Commit | Subject |
| --- | --- |
| `582a108` | `tickets: file REQ-014 skin port + adapter` |
| `3e5cea1` | `feat(REQ-014): add skin port and composed provider adapter` |
| this closeout commit | `docs(REQ-014): document skin contract and record evidence` |

## Status

Complete on `ticket/REQ-014-skin-port-adapter`. The platform now exposes the
pure Skin port, the composed USER-priority skin adapter and the reactive
`skinValue()` accessor. The branch is tagged `v0.6.0`; existing tags were not
moved. No app or runtime repo was modified.
