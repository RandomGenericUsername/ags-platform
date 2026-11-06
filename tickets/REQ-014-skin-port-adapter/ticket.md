---
id: REQ-014
title: "Skin port + adapter: composed skin CSS, reactive tokens, USER priority"
kind: requirement
status: in-progress
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

- [ ] `ports/skin.ts` is pure (no `gi://`, no `ags`, no I/O): token types,
      `parseSkinJson`, contract validation, role-expression validation,
      `composeSkinCss`, replacing sink, `createSkin`, token accessor factory.
- [ ] `adapters/skin.ts` resolves the two XDG pointers, reads/composes/applies,
      passes USER priority (800), replaces add-before-remove, holds monitors
      module-scoped, debounces 50 ms, reports through `onError`, and exposes
      `skinValue()`.
- [ ] `index.ts` explicitly re-exports the new port + adapter symbols.
- [ ] Pure tests prove palette composition, USER priority, add-before-remove,
      GC-safe monitor lifetime/cleanup, reload on either file, missing-artifact
      no-op, malformed-skin retention, accessor fallback, and literal-hex /
      structure / transition rejection.
- [ ] README + CHANGELOG document the USER-priority rule and one-provider
      invariant prominently; INDEX updated.
- [ ] `make test`, `make typecheck-tests` and local `make typecheck` green.
- [ ] Annotated `v0.6.0` tag (next minor; existing tags untouched).

## Evidence / verify

Filled in the closeout commit with command → result. The implementation must
show the pure suite and both gates green from this worktree.

Note: `scripts/worktree-guard.sh --check-clean` (the spelling in
`tickets/LIFECYCLE.md`) prints usage and exits 2 because the script accepts
`check-clean`; `create` itself runs the cleanliness check and succeeded. This
ticket records the discrepancy instead of editing the guard.

## Commits

| Commit | Subject |
| --- | --- |
| this planning commit | `tickets: file REQ-014 skin port + adapter` |
