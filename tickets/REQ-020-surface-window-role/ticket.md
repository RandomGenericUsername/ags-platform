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

- [x] `surface.window` is required with exactly the eight tokens; a document
      without the group or without one token fails closed, and an extra window
      token fails as unknown.
- [x] `surface.window.opacity` is a unitless number in `[0, 1]`; strings,
      negatives, values above `1`, percentages and non-finite numbers fail.
- [x] The other seven window tokens use the existing kinds (paint, border,
      non-negative number, shadow, blur) and inherit the existing hex,
      transition, structure/variant and unit rules.
- [x] Panel/card/control/cell/pill behavior is unchanged; no window↔panel alias
      or fallback exists in the parser.
- [x] A v0.12.0 resolved token document (six surface roles) and a v0.12.0
      generation manifest parse.
- [x] Fixtures and tests cover the valid window group, a missing group, a
      missing token, an extra token, and opacity bounds/type.
- [x] README and CHANGELOG document the window role and `v1.1.0`.
- [x] `make gates` is green.
- [x] Annotated `v1.1.0` tag on the closeout commit; branch merged
      fast-forward to `main`; `main` and the tag pushed.

## Evidence / verify

Run from `.worktrees/REQ-020/`, branch
`ticket/REQ-020-surface-window-role`, base `10b4d11` (main, `v1.0.1`).

| Claim | Command | Result |
| --- | --- | --- |
| Red before the change (window fixture) | `node --test tests/appearance.test.ts tests/appearance-v3.test.ts` | failed with `tokens.json:surface.window: unknown appearance token "window"` (exit 1) |
| Window suites after the change | `node --test tests/appearance.test.ts tests/appearance-v3.test.ts` | `36 pass / 0 fail`, exit 0 |
| Full pure suite | `make test` | `136 pass / 0 fail`, exit 0 |
| Package/export gate | `make exports` | `2 pass / 0 fail`, exit 0 |
| Pure test typecheck | `make typecheck-tests` | `OK: 0 errors in the pure test suite` |
| Local desktop typecheck | `make typecheck` | `OK: 0 errors in the ags-platform tree`; 7 tolerated `/usr/share/ags/js` errors |
| All local gates | `make gates` | exit 0 (136/2/0/0) |
| Embedded schema + opacity kind | `grep -n 'window: Object.freeze\|"opacity"\|case "opacity"' ports/appearance.ts` | line 316 `window`, line 324 `opacity: "opacity"`, line 425 `case "opacity"` |
| Required, not aliased | `node --test tests/appearance.test.ts` | missing window → `required by the v2 vocabulary`; missing panel → same; window radius reads `12`, panel `18` |
| Versions follow contracts | `node --test tests/appearance-v3.test.ts` | token document `version: 2`; generation manifest `version: 3` |
| No app source change needed | `grep -rn '"surface\.\|parseAppearanceJson\|parseAppearanceTokens\|APPEARANCE_VERSION' <app repos> --include='*.ts' --include='*.tsx'` | no matches (exit 1); apps only call `appearance.value("layout.<app>.<token>", fallback)` |
| Downstream pins are still pre-window | `grep -n 'ags-platform:\|contracts:\|dotfiles-assets:' dotfiles-v3/dotfiles/provisioning/program-tuple.yaml` | `ags-platform: v1.0.1`, `contracts: v0.11.0`, `dotfiles-assets: v0.18.1` |
| App + provisioning platform pins | `grep -rn 'AGS_PLATFORM_VERSION :=\|ags_platform_version:'` | every app `v1.0.1`; `dotfiles-provision` `v1.0.1` |
| Runtime/assets still pre-window | `grep -n '0.11.0\|0.12.0' dotfiles-assets/Makefile`; runtime vendored `contracts/schemas/appearance-json.schema.json` | assets says `vendored v0.11.0`; runtime schema describes five roles and no `surface.window` |
| Scope stayed inside `ags-platform` | `git diff --stat 10b4d11..HEAD` | only `CHANGELOG.md`, `README.md`, `ports/appearance.ts`, the two appearance test files, the fixture and the ticket/INDEX; no runtime/assets/provisioning/composition/app/live state |

## Downstream parity audit

The parser change is API-compatible: `value(path, fallback)`, the generation
apply/ack and the provider sink are unchanged, and no app reads a surface token
or the parser directly. However, an app pinned to `v1.0.1` would reject a
window-bearing generation with `unknown appearance token "window"`, so a parity
wave is required **before** runtime emits `surface.window`:

- `dotfiles-runtime` — re-vendor contracts `v0.12.0` schemas and emit the
  required window group in every resolved `tokens.json`.
- `dotfiles-assets` — author `surface.window` in every skin manifest (both
  modes) and re-run the skin gates.
- `dotfiles-provision` / composition — bump the program tuple from
  `ags-platform v1.0.1 / contracts v0.11.0 / dotfiles-assets v0.18.1` to the
  window-bearing set, including this `v1.1.0`.
- Every app repo — re-pin `AGS_PLATFORM_VERSION` to `v1.1.0` and re-run its
  gates; no app source edit is expected.

## Commits

| Commit | Subject |
| --- | --- |
| `695d25b` | `tickets: file REQ-020 surface window role` |
| `7bb1719` | `feat(REQ-020): accept required surface.window role` |
| `35cd44c` | `docs(REQ-020): document surface window role and v1.1.0` |
| this closeout commit | `docs(REQ-020): record surface window evidence` |

## Status

Complete on `ticket/REQ-020-surface-window-role`; worktree
`.worktrees/REQ-020/`, base `10b4d11` (main, `v1.0.1`). The closeout commit is
tagged `v1.1.0` and the branch is merged fast-forward to `main`; `main` and the
tag are pushed. No runtime, assets, provisioning, composition, app or live-state
repository was modified.
