---
id: REQ-015
title: "Skin token validation: per-token kinds for the frozen v0.6.0 vocabulary"
kind: requirement
status: in-progress
lane: 3
links:
  openspec: none
  bmad: none
worktree: .worktrees/REQ-015/
branch: ticket/REQ-015-skin-token-validation
---

# Skin token validation: per-token kinds for the frozen v0.6.0 vocabulary

## Requirement

Correct the `ports/skin.ts` validator after `v0.6.0`: the group-based rule treats
every `surface.*` and `ink.*` value as a bare `@role`, so it rejects the values
the runtime actually resolves. Real built-in skins contain
`alpha(@surface, 0.94)`, `color-mix(in srgb, …)`, `shadow: "none"`,
`blur: "none"`, `ink-dim: "alpha(@on_surface, 0.62)"` and
`ink-over: "auto"`. The validator also lacks `hairline-w`, the numeric token
added by contracts v0.6.0, and it still accepts unknown numeric tokens generically.

Validation MUST use the canonical per-token kinds (number / paint / shadow /
blur / ink / auto / cell-pad / font) from `contracts`
`schemas/skin-token.schema.json` and `skins.md` v0.6.0:

- **number** (unitless, finite, `>= 0`): `radius-panel`, `radius-card`,
  `radius-cell`, `radius-pill`, `border-w`, `hairline-w`, `gap`, `title-size`,
  `text-size`, `panel-width`, `bt-list-spacing`, `bar-row-height`, `chip-min`.
- **paint** (`surface.bg-panel`, `surface.bg-card`, `surface.border`):
  `transparent` | `@role` | `alpha(@role, 0..1)` |
  `color-mix(in srgb, @role <pct>%, transparent|@role)`.
- **shadow** (`surface.shadow`): a non-empty CSS shadow string; `none` is
  allowed. `rgba(0,0,0,0.5)` is legal; a literal hex is not.
- **blur** (`surface.blur`): `none` or
  `blur(<n>px)` with an optional `saturate(<n>)`.
- **ink** (`ink.ink`, `ink.ink-dim`, `ink.accent`): `@role` or
  `alpha(@role, 0..1)`.
- **auto** (`ink.ink-over`): exactly `"auto"`.
- **cell-pad** (`rhythm.cell-pad`): exactly `"<n>px <n>px"`.
- **font** (`type.font-family`): a non-empty CSS font-family string;
  `"inherit"` is allowed.
- `type.title-size`, `type.text-size`, `rhythm.gap` and all `layout.*` tokens
  are numbers.

The existing guards stay: literal `#hex`, `transition` (name or value),
`structure`/`variant` names and unknown groups are rejected. Unknown token
names are rejected because the canonical schema is a closed vocabulary.

The public API stays stable; only the accepted token values and the docs change.

## Acceptance

- [x] `ports/skin.ts` validates by per-token kind, adds `hairline-w`, rejects
      numeric strings, bad paint/ink/shadow/blur/cell-pad values and unknown
      tokens, and keeps the forbidden-name / hex / transition guards.
- [x] `ports/skin.ts` docs and `SKIN_TOKEN_GROUPS` docs describe the v0.6.0
      per-token vocabulary and the supported value grammar.
- [x] `tests/skin.test.ts` uses hard-coded resolved fixtures for `glass`,
      `flat` and `paper` (24 tokens after v0.6.0) and proves all three parse;
      the negative cases reject numeric length strings, literal hex paint,
      `transition`, `structure`, `ink-over: "manual"`, bad cell-pad and a
      shadow with hex.
- [x] README and CHANGELOG describe the per-token validation and `hairline-w`.
- [x] `node --test tests/skin.test.ts`, `make test`, `make exports`,
      `make typecheck-tests` and local `make typecheck` are green.
- [x] Annotated `v0.7.0` tag on the closeout commit; branch merged
      fast-forward to `main`; existing tags untouched.

## Evidence / verify

Run from `.worktrees/REQ-015/`, branch `ticket/REQ-015-skin-token-validation`,
base `2aaa78d` (main, `v0.6.0`).

| Claim | Command | Result |
| --- | --- | --- |
| Skin suite | `node --test tests/skin.test.ts` | `21 pass / 0 fail`, exit 0 |
| Full pure suite | `make test` | `92 pass / 0 fail`, exit 0 |
| Package/export gate | `make exports` | `2 pass / 0 fail`, exit 0 |
| Pure test typecheck | `make typecheck-tests` | `OK: 0 errors in the pure test suite` |
| Local desktop typecheck | `ags types -d "$PWD" -u` then `make typecheck` | `OK: 0 errors in the ags-platform tree`; 7 tolerated `/usr/share/ags/js` errors |
| Three built-ins parse | `node --test tests/skin.test.ts` | `glass`, `flat`, `paper` each parse to exactly 24 `group.name` values; `shape.hairline-w` is numeric; `ink.ink-over === "auto"` |
| Real glass values accepted | `node --test tests/skin.test.ts` | `surface.bg-panel = alpha(@surface, 0.94)`, `surface.shadow = none`, `surface.blur = none`, `ink.ink-dim = alpha(@on_surface, 0.62)` all parse |
| Numeric strings rejected | `node --test tests/skin.test.ts` | `"12px"` / `"312"` in number positions throw with `unitless`; negative numbers throw `non-negative` |
| Paint / ink / auto grammar | `node --test tests/skin.test.ts` | `transparent`, `@role`, `alpha(@role, 0.94)` and `color-mix(in srgb, @outline 60%, transparent)` pass; `#ff0000`, arbitrary `red`, out-of-range alpha/color-mix and `ink-over: "manual"` fail |
| Shadow / blur / cell-pad / font | `node --test tests/skin.test.ts` | `rgba(0,0,0,0.22)` shadow and `blur(18px) saturate(1.2)` pass; hex shadow, bad blur, `"8px"`/`"8px 9px 10px"` cell-pad and empty/hex font fail |
| Forbidden vocabulary | `node --test tests/skin.test.ts` | `structure`, `variant`, `bg-panel-variant`, `transition-speed`, `shape.radius` and `layout.app-additive-token` all reject; unknown groups reject |
| CSS guards unchanged | `node --test tests/skin.test.ts` | `validateSkinCss` still rejects literal hex, `transition` and `--structure`/`--variant` properties |
| USER priority / one provider | `node --test tests/skin.test.ts` | every `host.add` receives 800; five refreshes keep exactly one provider and peak at 2 |
| Existing tags untouched | `git tag -l` | still `v0.1.0`…`v0.6.0`; new tag is `v0.7.0` |

### Deviations / notes

- The checked-out `contracts` repository in this workspace is at `v0.5.2`; it
  does not contain a `v0.6.0` tag or `hairline-w` yet. The implementation
  follows the v0.6.0 per-token types supplied with this ticket. The fixture
  file records that source gap: its `glass`/`paper` hairlines are `1` and
  `flat` is `0`, splitting the existing panel `border-w` from the 1px
  hairlines. When contracts v0.6.0 and the matching assets manifests are
  present, re-check those three values; no parser change is expected.
- The assets repository is not available to the stock test runner, so the
  three resolved maps are hard-coded in `tests/fixtures/skins.ts` with the
  manifest names and contract tag in its comment (no cross-repo import).

## Commits

| Commit | Subject |
| --- | --- |
| `3a3ef0b` | `tickets: file REQ-015 skin token validation` |
| `f6e393b` | `fix(REQ-015): validate skin tokens by canonical per-token kind` |
| this closeout commit | `docs(REQ-015): document per-token skin validation and record evidence` |

## Status

Complete on `ticket/REQ-015-skin-token-validation`; worktree
`.worktrees/REQ-015/`, base `2aaa78d` (main, `v0.6.0`). The branch is tagged
`v0.7.0` and merged fast-forward to `main`; existing tags were not moved. No
other repository was modified.
