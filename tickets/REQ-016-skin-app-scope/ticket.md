---
id: REQ-016
title: "App-scoped Skin factory: per-configDir CSS and shared token map"
kind: requirement
status: in-progress
lane: 3
links:
  openspec: none
  bmad: none
worktree: .worktrees/REQ-016/
branch: ticket/REQ-016-skin-app-scope
---

# App-scoped Skin factory: per-configDir CSS and shared token map

## Requirement

The Skin adapter exports one singleton `skin` hardcoded to the bar's pointers
(`$XDG_CONFIG_HOME/ags/skin.css`). Contracts v0.6.0 now emits
`current/skins/<configDir>.css` per target and consumer pointers
`config/<configDir>/skin.css` + `skin.json`, so every non-bar AGS app must read
ITS OWN `skin.css` while sharing one token map.

The platform MUST expose an app-scoped factory and keep the existing bar API
stable:

- `createAppSkin({ configDir, ...overrides })` resolves
  `$XDG_CONFIG_HOME/<configDir>/skin.css`, the shared
  `$XDG_STATE_HOME/dotfiles/current/skin.json`, and the unchanged palette
  artifacts (`$XDG_CONFIG_HOME/ags/colors.css`,
  `$XDG_STATE_HOME/dotfiles/current/colors.yaml`). Sink, monitor, composition,
  priority and failure semantics are unchanged.
- The default exported `skin` singleton is exactly
  `createAppSkin({ configDir: "ags" })`, so the bar has no behavior change.
- A matching `createAppSkinValue(skin, key, fallback)` gives non-bar apps the
  same accessor semantics without changing `skinValue(key, fallback)`.
- `configDir` is an input; the platform carries no app list or app-specific
  policy.
- `index.ts` re-exports the factory, accessor and options type explicitly.

Evidence: contracts v0.6.0 `skins.md:155-198` ("Template set and consumer
artifacts"): one template/output per `configDir`, one shared `current/skin.json`,
and the consumer pointer `$XDG_CONFIG_HOME/<configDir>/skin.css`; for the bar
`configDir = ags`.

Verify:

```bash
cd /home/inumaki/Development/dotfiles/contracts &&
  sed -n '155,198p' skins.md
```

## Acceptance

- [x] `adapters/skin.ts` exports `createAppSkin` and `createAppSkinValue`;
      `skin` is `createAppSkin({ configDir: "ags" })` and `skinValue` keeps its
      existing signature.
- [x] App path resolution is pure/testable: per-`configDir` CSS, one shared
      `skin.json`, unchanged palette paths.
- [x] `index.ts` explicitly re-exports `createAppSkin`, `createAppSkinValue` and
      `AppSkinOptions`.
- [x] Tests prove per-configDir resolution, instance isolation (providers and
      monitors), the `ags` default, missing-artifact no-op, USER priority (800)
      and palette-block composition.
- [x] README documents the app pattern; CHANGELOG records the release.
- [x] `node --test tests/skin.test.ts`, `make test`, `make exports`,
      `make typecheck-tests` and local `make typecheck` are green.
- [x] Annotated `v0.8.0` tag on the closeout commit; branch merged
      fast-forward to `main`; existing tags untouched.

## Evidence / verify

Run from `.worktrees/REQ-016/`, branch `ticket/REQ-016-skin-app-scope`, base
`c122026` (main, `v0.7.0`).

| Claim | Command | Result |
| --- | --- | --- |
| Skin suite | `node --test tests/skin.test.ts` | `26 pass / 0 fail`, exit 0 |
| Full pure suite | `make test` | `97 pass / 0 fail`, exit 0 |
| Package/export gate | `make exports` | `2 pass / 0 fail`, exit 0 |
| Pure test typecheck | `make typecheck-tests` | `OK: 0 errors in the pure test suite` |
| Local desktop typecheck | `ags types -d "$PWD" -u` then `make typecheck` | `OK: 0 errors in the ags-platform tree`; 7 tolerated `/usr/share/ags/js` errors |
| Per-configDir paths | `node --test tests/skin.test.ts` | `ags-clipboard` → `/cfg/ags-clipboard/skin.css`, `ags-notifications` → `/cfg/ags-notifications/skin.css`; both keep `/state/dotfiles/current/skin.json` + shared palette paths |
| Instance isolation | `node --test tests/skin.test.ts` | Two instances keep separate displays and 4 active watchers; releasing one leaves the other's 2 watchers live and reloading |
| Bar default | `node --test tests/skin.test.ts` | Adapter source pins `export const skin = createAppSkin({ configDir: "ags" })` |
| Missing artifacts | `node --test tests/skin.test.ts` | Missing `skin.css` or `skin.json` installs 0 providers, reports 0 errors, keeps the fallback |
| USER priority + palette composition | `node --test tests/skin.test.ts` | App-scoped add receives 800; composed CSS starts with `colors.css`, defines `on_surface`, then applies the skin rules |
| App accessor | `node --test tests/skin.test.ts` | `createSkinValue` against the app instance reads 312 then updates to 420 on a `skin.json` reload |
| Explicit index export | `grep -n "createAppSkin" index.ts` | `createAppSkin` / `createAppSkinValue` in the adapter re-export block and `AppSkinOptions` type export |
| Existing tags untouched | `git tag -l` | still `v0.1.0`…`v0.7.0`; new tag is `v0.8.0` |

### Deviations / notes

- The GI-free factory core lives in `adapters/skin-scope.ts` so the stock
  `node --test` suite can exercise path resolution and instance isolation
  without a desktop stack. `adapters/skin.ts` supplies the GLib dirs and the
  GTK sink; the public API remains `createAppSkin` there.
- `createAppSkin` also accepts `sink`/`readFile`/`watchFile`/`onError`
  overrides (test seams). Production apps pass only `configDir`.
- No consumer app repository was modified; adopting the factory in
  clipboard/notifications/etc. is a separate consumer change.

## Commits

| Commit | Subject |
| --- | --- |
| `edb5dd8` | `tickets: file REQ-016 app-scoped skin factory` |
| `232c391` | `feat(REQ-016): scope skin by app configDir` |
| `ab804dc` | `docs(REQ-016): document app-scoped skin instances` |
| this closeout commit | `docs(REQ-016): record app-scoped skin evidence` |

## Status

Complete on `ticket/REQ-016-skin-app-scope`; worktree `.worktrees/REQ-016/`,
base `c122026` (main, `v0.7.0`). The branch is tagged `v0.8.0` and merged
fast-forward to `main`; existing tags were not moved. No other repository was
modified.
