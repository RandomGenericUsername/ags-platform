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

- [ ] `ports/skin.ts` validates by per-token kind, adds `hairline-w`, rejects
      numeric strings, bad paint/ink/shadow/blur/cell-pad values and unknown
      tokens, and keeps the forbidden-name / hex / transition guards.
- [ ] `ports/skin.ts` docs and `SKIN_TOKEN_GROUPS` docs describe the v0.6.0
      per-token vocabulary and the supported value grammar.
- [ ] `tests/skin.test.ts` uses hard-coded resolved fixtures for `glass`,
      `flat` and `paper` (24 tokens after v0.6.0) and proves all three parse;
      the negative cases reject numeric length strings, literal hex paint,
      `transition`, `structure`, `ink-over: "manual"`, bad cell-pad and a
      shadow with hex.
- [ ] README and CHANGELOG describe the per-token validation and `hairline-w`.
- [ ] `node --test tests/skin.test.ts`, `make test`, `make exports`,
      `make typecheck-tests` and local `make typecheck` are green.
- [ ] Annotated `v0.7.0` tag on the closeout commit; branch merged
      fast-forward to `main`; existing tags untouched.

## Evidence / verify

Evidence recorded at closeout; see the table in the final commit.

## Commits

| Commit | Subject |
| --- | --- |
| this planning commit | `tickets: file REQ-015 skin token validation` |

## Status

In progress on `ticket/REQ-015-skin-token-validation`, worktree
`.worktrees/REQ-015/`, base `2aaa78d` (main, `v0.6.0`).
