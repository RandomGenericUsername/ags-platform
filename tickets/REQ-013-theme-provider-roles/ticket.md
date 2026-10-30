---
id: REQ-013
title: "Theme provider: palette.v1 role API + change subscription"
kind: requirement
status: proposed
lane: 3
links:
  openspec: none
  bmad: none
worktree: none
branch: none
---

# Theme provider: palette.v1 role API + subscription

## Requirement

The platform already owns a Theme port
(`adapters/theme.ts`, `ports/theme`, REQ-007). Consumers still couple to
artifact shape: `@color_*` GTK defines in style.css and direct `colors.yaml`
reads (ICME, btop-theme-studio). This ticket turns the Theme port into the
**provider seam**: one typed palette API plus one change subscription, with
producer shape hidden behind it.

### Behavior

1. `palette()` returns the declared `palette.v1` role set (50 Material roles +
   `on_backdrop`, versioned) as typed data, loaded from the runtime `current/`
   pointer. No app reads `colors.yaml`/`colors.gtk.css` directly.
2. `subscribe(cb)` emits on palette change; the provider attaches the new GTK
   CSS provider and removes the previous one (BUG-001 invariant). All apps use
   this single mechanism; per-app refresh handlers stop reading the filesystem.
3. The provider owns the CSS projection: one `@define-color` per role. The
   legacy `color_00..15` alias block is not part of the kit.
4. Kit components (bar/panels/shared widgets) use role-named CSS variables;
   app migrations consume the same roles (icme, btop-theme-studio,
   wallpaper-selector, capture, clipboard, notifications, bar).
5. `on_backdrop` is exposed for surfaces that float over the wallpaper.

## Acceptance

- [ ] `palette()` + `subscribe()` typed API, conformance-tested against the
      runtime vocabulary contract (REQ-006).
- [ ] Kit CSS contains no `@color_` / `color0..15` references.
- [ ] Provider replaces (never accumulates) CSS providers; refresh is driven by
      one subscription.
- [ ] At least the kit + one app migrated in this repo's conformance fixtures;
      per-app migrations have their own tickets.
- [ ] `make gates` green; publish a platform tag.

## Evidence / Verify

- Evidence: `adapters/theme.ts`, `ports/theme`, BUG-001.
- Verify: conformance suite; `rg '@color_' adapters ports` → 0.
