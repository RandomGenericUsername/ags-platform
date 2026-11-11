---
id: REQ-020
title: "Appearance parser accepts the required contracts v0.12.0 surface.window role"
kind: requirement
status: in-progress
lane: 3
links:
  openspec: none
  bmad: none
worktree: .worktrees/REQ-020/
branch: ticket/REQ-020-surface-window-role
---

# Appearance parser accepts the required contracts v0.12.0 surface.window role

## Requirement

Contracts `v0.12.0` (`REQ-020-window-role`) adds a required **`surface.window`**
outer/toplevel role to the resolved appearance token document and the appearance
manifest. It has exactly eight tokens:

| Token | Kind |
| --- | --- |
| `bg` | paint (palette role expression only) |
| `border` | border paint (role expression) |
| `border-width` | non-negative unitless number |
| `radius` | non-negative unitless number |
| `padding` | non-negative unitless number |
| `shadow` | shadow paint |
| `blur` | `none` or `blur(<n>px)` with optional `saturate(<n>)` |
| `opacity` | unitless number in the inclusive `[0, 1]` range |

`surface.window` is required and is never aliased or derived from
`surface.panel`. The token-model version stays `2` and the generation manifest
stays `version: 3`; contracts `v0.12.0` explicitly keeps those versions, so
`APPEARANCE_VERSION` remains `2` (this supersedes the `= 3` proposal in
`dotfiles-v3/docs/113`).

`ags-platform` MUST:

- Accept and require `surface.window` with all eight tokens in
  `parseAppearanceJson` / `parseAppearanceTokens`, including inside a complete
  `mode.dark`/`mode.light` surface override.
- Validate `opacity` as a unitless finite number in `[0, 1]`; reject strings,
  percentages, NaN/Infinity, negatives and values above `1`.
- Apply the existing kinds and existing closed-object rules to the other seven
  tokens; no new paint/role vocabulary and no literal hex.
- Preserve `surface.panel`, `surface.card`, `surface.control`, `surface.cell`
  and `surface.pill` behavior exactly; there is no panel alias or fallback for
  window and no window alias for panel.
- Parse a `v0.12.0` resolved token document and generation manifest; the
  generation manifest `version: 3` shape is unchanged.
- Update the embedded surface schema, the copied fixtures and the tests.
- Change no runtime, assets, provisioning, composition, app or live-state code.
  The `value(path, fallback)` API is unchanged, so app code is expected to stay
  API-compatible.

## Acceptance

- [ ] `surface.window` is required with exactly the eight tokens; a document
      without the group or without one token fails closed, and an extra window
      token fails as unknown.
- [ ] `surface.window.opacity` is a unitless number in `[0, 1]`; strings,
      negatives, values above `1`, percentages and non-finite numbers fail.
- [ ] The other seven window tokens use the existing kinds (paint, border,
      non-negative number, shadow, blur) and inherit the existing hex,
      transition, structure/variant and unit rules.
- [ ] Panel/card/control/cell/pill behavior is unchanged; no window↔panel alias
      or fallback exists in the parser.
- [ ] A v0.12.0 resolved token document (six surface roles) and a v0.12.0
      generation manifest parse.
- [ ] Fixtures and tests cover the valid window group, a missing group, a
      missing token, an extra token, and opacity bounds/type.
- [ ] README and CHANGELOG document the window role and `v1.1.0`.
- [ ] `make gates` is green.
- [ ] Annotated `v1.1.0` tag on the closeout commit; branch merged
      fast-forward to `main`; `main` and the tag pushed.

## Evidence / verify

Filled by the closeout commit.

## Commits

| Commit | Subject |
| --- | --- |
| this commit | `tickets: file REQ-020 surface window role` |

## Status

In progress on `ticket/REQ-020-surface-window-role`; worktree
`.worktrees/REQ-020/`, base `10b4d11` (main, `v1.0.1`).
