---
id: REQ-017
title: "Unified Appearance consumer: one provider, one monitor, one apply"
kind: requirement
status: in-progress
lane: 3
links:
  openspec: none
  bmad: none
worktree: .worktrees/REQ-017/
branch: ticket/REQ-017-appearance-adapter
---

# Unified Appearance consumer: one provider, one monitor, one apply

## Requirement

Contracts `v0.7.0` freezes the appearance plane v2: palette, skin and mode are
published as one immutable generation behind the single atomically repointed
hop `$XDG_STATE_HOME/dotfiles/current/appearance`. `ags-platform` still exposes
the split `theme` + `skin` pair, which watches the wrong hop, installs two
providers and leaves `palette-refresh` handlers re-applying only the palette.

The platform MUST add one Appearance consumer while keeping the v1
`theme`/`skin` exports working as deprecated aliases for one release:

- **Pure port** `ports/appearance.ts`: the v2 token types/parser
  (`version: 2` + `surface`/`state`/`type`/`ink`/`layout`, optional `mode`
  overrides), `appearanceValue(tokens, path, fallback)`, composed-CSS
  validation (no literal hex, no `transition`, no structure/variant), a
  replacing sink at USER priority (800), and the `createAppearance` core.
- **Adapter** `adapters/appearance.ts`: `createAppearance({ configDir })`
  exposes `apply()`, `tokens()`, `subscribe()` and `value(path, fallback)`
  (accessor + `peek()`). It watches **only**
  `$XDG_STATE_HOME/dotfiles/current/appearance` with a `WATCH_MOVES`
  `Gio.FileMonitor`, 50 ms debounce and module-scoped monitor/provider refs.
  It reads the composed `$XDG_CONFIG_HOME/<configDir>/appearance.css` and
  `current/appearance/tokens.json` through the pointer after the event.
- **One provider per app, installed last**: the composed CSS is applied
  verbatim at `GTK_STYLE_PROVIDER_PRIORITY_USER` (800), add-before-remove. An
  apply is coalesced per generation (content/hash comparison) so a repoint
  plus convenience-link creation never applies twice. Missing artifacts are a
  no-op; the value accessor keeps its fallback.
- **Refresh helper** `createAppearanceRefreshHandler(appearance, work?)`: keeps
  the `palette-refresh` protocol and always calls `appearance.apply()`
  (whole appearance) before/with the app-owned work. It is idempotent by
  appearance hash, does not double-apply, and returns exactly one contract
  JSON response.
- `index.ts` explicitly re-exports the appearance surface. `theme`, `skin` and
  `skinValue` remain as deprecated aliases built on the same paths; their docs
  point at Appearance.
- Tests pin the watched path (`current/appearance`, not the stable config
  link), one apply per rename generation, verbatim CSS at priority 800 with
  add-before-remove, v2 token parsing and `value()` lookup/fallback, the
  refresh contract, missing/malformed fallback and structure/hex/transition
  rejection.
- Docs and CHANGELOG record the release; annotated tag **`v0.9.0`**; branch
  merged fast-forward to `main`; nothing pushed.

Evidence: contracts `v0.7.0` `appearance.md:121-155` (one pointer, one hop and
the "Consumers MUST watch `current/appearance`" rule), `appearance.md:68-78`
(resolved `tokens.json` shape), `appearance.md:157-227` (v2 token groups and
mode overrides), `appearance.md:287-309` (one provider at USER priority and the
whole-appearance refresh contract), and
`schemas/appearance-json.schema.json` +
`schemas/appearance-manifest.schema.json` + `schemas/appearance-artifact.schema.json`.
Design record: `dotfiles-v3/docs/105-appearance-plane-v2.md:125-219` and
`:221-285`.

Verify:

```bash
cd /home/inumaki/Development/dotfiles/contracts &&
  git describe --tags --exact-match &&
  sed -n '68,78p;121,155p;287,309p' appearance.md
```

## Acceptance

- [ ] `ports/appearance.ts` is pure and exports the token types/parser,
      `appearanceValue`, composed-CSS validation, the replacing sink and the
      `createAppearance` core.
- [ ] `adapters/appearance.ts` exposes `createAppearance({ configDir })` with
      `apply()`, `tokens()`, `subscribe()` and `value(path, fallback)`;
      `createAppearanceRefreshHandler(appearance, work?)` always re-applies the
      whole appearance and answers one contract JSON response.
- [ ] The adapter watches exactly `current/appearance`, uses `WATCH_MOVES`,
      a 50 ms debounce and module-scoped monitor/provider refs.
- [ ] One apply per generation: a rename simulation emits one provider swap;
      the composed CSS is applied verbatim at priority 800, add-before-remove,
      and missing artifacts are a no-op with the value fallback intact.
- [ ] `theme`, `skin` and `skinValue` remain exported and documented as
      deprecated aliases pointing at Appearance.
- [ ] `index.ts` explicitly exports the appearance port, adapter and types.
- [ ] `node --test tests/skin.test.ts tests/appearance.test.ts`, `make test`,
      `make exports`, `make typecheck-tests` and local `make typecheck` are
      green.
- [ ] README/CHANGELOG document the release; annotated `v0.9.0` tag on the
      closeout commit; branch merged fast-forward to `main`; nothing pushed.

## Evidence / verify

Run from `.worktrees/REQ-017/`, branch `ticket/REQ-017-appearance-adapter`,
base `7c060a3` (main, `v0.8.0`).

| Claim | Command | Result |
| --- | --- | --- |
| Evidence table is filled by the closeout commit. | `git show v0.9.0:tickets/REQ-017-appearance-adapter/ticket.md` | pending |

### Deviations / notes

- Pending implementation.

## Commits

| Commit | Subject |
| --- | --- |
| this commit | `tickets: file REQ-017 unified appearance consumer` |

## Status

In progress on `ticket/REQ-017-appearance-adapter`; worktree
`.worktrees/REQ-017/`, base `7c060a3` (main, `v0.8.0`).
