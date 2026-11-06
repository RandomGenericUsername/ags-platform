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

- [ ] `adapters/skin.ts` exports `createAppSkin` and `createAppSkinValue`;
      `skin` is `createAppSkin({ configDir: "ags" })` and `skinValue` keeps its
      existing signature.
- [ ] App path resolution is pure/testable: per-`configDir` CSS, one shared
      `skin.json`, unchanged palette paths.
- [ ] `index.ts` explicitly re-exports `createAppSkin`, `createAppSkinValue` and
      `AppSkinOptions`.
- [ ] Tests prove per-configDir resolution, instance isolation (providers and
      monitors), the `ags` default, missing-artifact no-op, USER priority (800)
      and palette-block composition.
- [ ] README documents the app pattern; CHANGELOG records the release.
- [ ] `node --test tests/skin.test.ts`, `make test`, `make exports`,
      `make typecheck-tests` and local `make typecheck` are green.
- [ ] Annotated `v0.8.0` tag on the closeout commit; branch merged
      fast-forward to `main`; existing tags untouched.

## Evidence / verify

Run from `.worktrees/REQ-016/`, branch `ticket/REQ-016-skin-app-scope`, base
`c122026` (main, `v0.7.0`).

| Claim | Command | Result |
| --- | --- | --- |
| Pending | Pending | Pending |

### Deviations / notes

Pending closeout.

## Commits

| Commit | Subject |
| --- | --- |
| this commit | `tickets: file REQ-016 app-scoped skin factory` |

## Status

In progress on `ticket/REQ-016-skin-app-scope`, worktree `.worktrees/REQ-016/`,
base `c122026` (main, `v0.7.0`).
